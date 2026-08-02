<?php

namespace Persi\HeadlessAccount\Diagnostics;

defined( 'ABSPATH' ) || exit;

final class OAuthAuditService {
	private const OLD_RECORD_DAYS = 365;

	public function __construct(
		private $database,
		private readonly string $secret
	) {}

	public function report( string $supplied_session = '' ): array {
		$identity_table = $this->database->prefix . 'persi_account_identities';
		$session_table  = $this->database->prefix . 'persi_account_sessions';
		$identity_exists = $this->table_exists( $identity_table );
		$session_exists  = $this->table_exists( $session_table );
		$identities = $identity_exists
			? $this->database->get_results(
				"SELECT id, user_id, provider, provider_subject_hash, email_hash,
					created_at, updated_at, last_login_at
				FROM {$identity_table}
				ORDER BY provider, user_id, id",
				ARRAY_A
			)
			: array();
		$identities = is_array( $identities ) ? $identities : array();
		$active_sessions = $session_exists
			? $this->active_sessions_by_user( $session_table )
			: array();
		$email_hash_users = $this->users_by_email_hash();
		$repair_context = $this->repair_context( $identities );

		$items = array();
		$counts = array(
			'google'              => 0,
			'facebook'            => 0,
			'invalid_provider'     => 0,
			'orphan_identity'      => 0,
			'email_hash_mismatch'  => 0,
			'identity_user_mismatch'=> 0,
			'auto_repair_possible' => 0,
			'old_record'           => 0,
			'test_record'          => 0,
		);
		$old_before = time() - ( self::OLD_RECORD_DAYS * DAY_IN_SECONDS );

		foreach ( $identities as $identity ) {
			$provider = (string) ( $identity['provider'] ?? '' );
			$user_id  = (int) ( $identity['user_id'] ?? 0 );
			$user     = $user_id > 0 ? get_user_by( 'id', $user_id ) : false;
			$valid_provider = in_array( $provider, array( 'google', 'facebook' ), true );
			if ( isset( $counts[ $provider ] ) ) {
				++$counts[ $provider ];
			}
			if ( ! $valid_provider ) {
				++$counts['invalid_provider'];
			}

			$user_exists = $user instanceof \WP_User;
			if ( ! $user_exists ) {
				++$counts['orphan_identity'];
			}
			$email_consistency = 'USER_NOT_FOUND';
			$is_test = false;
			if ( $user_exists ) {
				$expected_email_hash = hash_hmac(
					'sha256',
					'oauth|email|' . strtolower( (string) $user->user_email ),
					$this->secret
				);
				$email_consistency = hash_equals(
					$expected_email_hash,
					(string) ( $identity['email_hash'] ?? '' )
				) ? 'CONSISTENT' : 'EMAIL_HASH_MISMATCH';
				if ( 'EMAIL_HASH_MISMATCH' === $email_consistency ) {
					++$counts['email_hash_mismatch'];
					++$counts['identity_user_mismatch'];
				}
				$is_test = $this->is_test_user( $user );
				if ( $is_test ) {
					++$counts['test_record'];
				}
			}

			$created_timestamp = strtotime( (string) ( $identity['created_at'] ?? '' ) . ' UTC' );
			$is_old = false !== $created_timestamp && $created_timestamp < $old_before;
			if ( $is_old ) {
				++$counts['old_record'];
			}

			$flags = array();
			if ( ! $valid_provider ) $flags[] = 'INVALID_PROVIDER';
			if ( ! $user_exists ) $flags[] = 'ORPHAN_IDENTITY';
			if ( 'EMAIL_HASH_MISMATCH' === $email_consistency ) {
				$flags[] = 'EMAIL_HASH_MISMATCH';
				$flags[] = 'OAUTH_IDENTITY_USER_MISMATCH';
			}
			if ( $is_old ) $flags[] = 'OLD_RECORD';
			if ( $is_test ) $flags[] = 'TEST_RECORD';

			$repair = $this->auto_repair_assessment( $identity, $user_id, $email_hash_users, $repair_context );
			if ( 'YES' === $repair['possible'] ) {
				++$counts['auto_repair_possible'];
			}

			$items[] = array(
				'identityId'        => (int) ( $identity['id'] ?? 0 ),
				'provider'          => $provider,
				'userId'            => $user_id,
				'createdAt'         => (string) ( $identity['created_at'] ?? '' ),
				'userStatus'        => $user_exists ? 'EXISTS' : 'MISSING',
				'emailConsistency'  => $email_consistency,
				'activeSessions'    => (int) ( $active_sessions[ $user_id ] ?? 0 ),
				'autoRepair'        => $repair,
				'flags'             => $flags,
			);
		}

		return array(
			'generatedAt' => gmdate( 'c' ),
			'readOnly'    => true,
			'plugin'      => array(
				'installedVersion' => defined( 'PERSI_HEADLESS_ACCOUNT_VERSION' )
					? PERSI_HEADLESS_ACCOUNT_VERSION
					: 'UNKNOWN',
				'databaseVersion'  => (string) get_option( 'persi_headless_account_db_version', '' ),
				'installations'    => $this->plugin_installations(),
			),
			'summary' => array(
				'wordpressUsers'                  => $this->wordpress_user_count(),
				'googleIdentities'                => $counts['google'],
				'facebookIdentities'              => $counts['facebook'],
				'activeSessions'                  => $session_exists ? $this->active_session_count( $session_table ) : 0,
				'invalidProviders'                => $counts['invalid_provider'],
				'orphanIdentities'                => $counts['orphan_identity'],
				'emailHashMismatches'             => $counts['email_hash_mismatch'],
				'oauthIdentityUserMismatches'      => $counts['identity_user_mismatch'],
				'autoRepairPossible'               => $counts['auto_repair_possible'],
				'oldRecords'                      => $counts['old_record'],
				'testRecords'                     => $counts['test_record'],
				'duplicateProviderSubjectGroups'  => $identity_exists ? $this->duplicate_groups( $identity_table, 'provider, provider_subject_hash' ) : 0,
				'duplicateEmailHashGroups'        => $identity_exists ? $this->duplicate_groups( $identity_table, 'email_hash' ) : 0,
				'duplicateProviderEmailGroups'    => $identity_exists ? $this->duplicate_groups( $identity_table, 'provider, email_hash' ) : 0,
				'usersWithMultipleProviders'      => $identity_exists ? $this->multiple_provider_users( $identity_table ) : 0,
			),
			'identities' => array(
				'google'   => array_values( array_filter( $items, static fn( array $item ): bool => 'google' === $item['provider'] ) ),
				'facebook' => array_values( array_filter( $items, static fn( array $item ): bool => 'facebook' === $item['provider'] ) ),
				'invalid'  => array_values( array_filter( $items, static fn( array $item ): bool => ! in_array( $item['provider'], array( 'google', 'facebook' ), true ) ) ),
			),
			'sessions' => $session_exists ? $this->session_audit( $session_table, $identities ) : $this->empty_session_audit(),
			'suppliedSessionResolution' => $session_exists
				? $this->supplied_session_resolution( $session_table, $identities, $supplied_session )
				: $this->empty_supplied_session_resolution( $supplied_session ),
			'tables' => array(
				'identities' => $identity_exists ? 'AVAILABLE' : 'MISSING',
				'sessions'   => $session_exists ? 'AVAILABLE' : 'MISSING',
			),
			'definitions' => array(
				'oldRecordDays' => self::OLD_RECORD_DAYS,
				'multipleActiveSessionsAreInformational' => true,
			),
		);
	}

	private function table_exists( string $table ): bool {
		return $table === $this->database->get_var(
			$this->database->prepare( 'SHOW TABLES LIKE %s', $table )
		);
	}

	private function wordpress_user_count(): int {
		$count = count_users();
		return (int) ( $count['total_users'] ?? 0 );
	}

	private function duplicate_groups( string $table, string $columns ): int {
		return (int) $this->database->get_var(
			"SELECT COUNT(*) FROM (
				SELECT 1 FROM {$table} GROUP BY {$columns} HAVING COUNT(*) > 1
			) duplicate_groups"
		);
	}

	private function multiple_provider_users( string $table ): int {
		return (int) $this->database->get_var(
			"SELECT COUNT(*) FROM (
				SELECT user_id FROM {$table}
				WHERE provider IN ('google', 'facebook')
				GROUP BY user_id HAVING COUNT(DISTINCT provider) > 1
			) multiple_providers"
		);
	}

	private function active_session_count( string $table ): int {
		$now = gmdate( 'Y-m-d H:i:s' );
		return (int) $this->database->get_var(
			$this->database->prepare(
				"SELECT COUNT(*) FROM {$table}
				WHERE status = 'active' AND idle_expires_at > %s AND absolute_expires_at > %s",
				$now,
				$now
			)
		);
	}

	private function active_sessions_by_user( string $table ): array {
		$now = gmdate( 'Y-m-d H:i:s' );
		$rows = $this->database->get_results(
			$this->database->prepare(
				"SELECT user_id, COUNT(*) session_count FROM {$table}
				WHERE status = 'active' AND idle_expires_at > %s AND absolute_expires_at > %s
				GROUP BY user_id",
				$now,
				$now
			),
			ARRAY_A
		);
		$result = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			$result[ (int) $row['user_id'] ] = (int) $row['session_count'];
		}
		return $result;
	}

	private function session_audit( string $table, array $identities ): array {
		$now = gmdate( 'Y-m-d H:i:s' );
		$orphan = (int) $this->database->get_var(
			"SELECT COUNT(*) FROM {$table} sessions
			LEFT JOIN {$this->database->users} users ON users.ID = sessions.user_id
			WHERE users.ID IS NULL"
		);
		$expired = (int) $this->database->get_var(
			$this->database->prepare(
				"SELECT COUNT(*) FROM {$table}
				WHERE status = 'expired'
					OR (status = 'active' AND (idle_expires_at <= %s OR absolute_expires_at <= %s))",
				$now,
				$now
			)
		);
		$multiple = (int) $this->database->get_var(
			$this->database->prepare(
				"SELECT COUNT(*) FROM (
					SELECT user_id FROM {$table}
					WHERE status = 'active' AND idle_expires_at > %s AND absolute_expires_at > %s
					GROUP BY user_id HAVING COUNT(*) > 1
				) multiple_sessions",
				$now,
				$now
			)
		);
		$resolution = $this->login_resolution( $table, $identities );
		return array(
			'orphanSessions'                 => $orphan,
			'sessionsWithoutUser'            => $orphan,
			'expiredSessions'                => $expired,
			'duplicateTokenHashGroups'       => $this->duplicate_groups( $table, 'token_hash' ),
			'usersWithMultipleActiveSessions'=> $multiple,
			'sessionProfileMismatches'        => count( array_filter(
				$resolution,
				static fn( array $item ): bool => in_array( 'SESSION_PROFILE_MISMATCH', $item['flags'], true )
			) ),
			'loginResolution'                 => $resolution,
		);
	}

	private function empty_session_audit(): array {
		return array(
			'orphanSessions' => 0,
			'sessionsWithoutUser' => 0,
			'expiredSessions' => 0,
			'duplicateTokenHashGroups' => 0,
			'usersWithMultipleActiveSessions' => 0,
			'sessionProfileMismatches' => 0,
			'loginResolution' => array(),
		);
	}

	private function login_resolution( string $table, array $identities ): array {
		$now = gmdate( 'Y-m-d H:i:s' );
		$sessions = $this->database->get_results(
			$this->database->prepare(
				"SELECT id, user_id FROM {$table}
				WHERE status = 'active' AND idle_expires_at > %s AND absolute_expires_at > %s
				ORDER BY user_id, id",
				$now,
				$now
			),
			ARRAY_A
		);
		$providers_by_user = array();
		foreach ( $identities as $identity ) {
			$user_id = (int) ( $identity['user_id'] ?? 0 );
			$providers_by_user[ $user_id ][] = array(
				'identityId' => (int) ( $identity['id'] ?? 0 ),
				'provider' => (string) ( $identity['provider'] ?? '' ),
				'identityUserId' => $user_id,
			);
		}

		$current_wp_user = wp_get_current_user();
		$current_wp_user_id = $current_wp_user instanceof \WP_User ? (int) $current_wp_user->ID : 0;
		$result = array();
		$resolved_identity_ids = array();
		foreach ( is_array( $sessions ) ? $sessions : array() as $session ) {
			$session_user_id = (int) ( $session['user_id'] ?? 0 );
			$user = get_user_by( 'id', $session_user_id );
			$account_user_id = $user instanceof \WP_User ? (int) $user->ID : null;
			$profile_user_id = null;
			if ( $user instanceof \WP_User && class_exists( 'WC_Customer' ) ) {
				$customer = new \WC_Customer( $user->ID );
				$profile_user_id = (int) $customer->get_id();
			}
			$linked = $providers_by_user[ $session_user_id ] ?? array(
				array( 'identityId' => null, 'provider' => 'NONE', 'identityUserId' => null ),
			);
			foreach ( $linked as $identity ) {
				if ( null !== $identity['identityId'] ) {
					$resolved_identity_ids[ $identity['identityId'] ] = true;
				}
				$flags = array();
				if ( null !== $identity['identityUserId'] && $identity['identityUserId'] !== $session_user_id ) {
					$flags[] = 'IDENTITY_SESSION_MISMATCH';
				}
				if ( null === $account_user_id || $session_user_id !== $account_user_id ) {
					$flags[] = 'SESSION_ACCOUNT_MISMATCH';
				}
				if ( null === $profile_user_id || $session_user_id !== $profile_user_id ) {
					$flags[] = 'SESSION_PROFILE_MISMATCH';
				}
				$result[] = array(
					'provider' => $identity['provider'],
					'identityId' => $identity['identityId'],
					'identityUserId' => $identity['identityUserId'],
					'sessionId' => (int) ( $session['id'] ?? 0 ),
					'sessionUserId' => $session_user_id,
					'currentWpUserId' => $current_wp_user_id,
					'currentWpUserContext' => 'AUDIT_ADMIN_REQUEST',
					'currentWpUserComparison' => $session_user_id === $current_wp_user_id ? 'MATCH' : 'MISMATCH',
					'accountApiUserId' => $account_user_id,
					'profileApiUserId' => $profile_user_id,
					'result' => empty( $flags ) ? 'PASS' : 'FAIL',
					'flags' => $flags,
				);
			}
		}
		foreach ( $identities as $identity ) {
			$identity_id = (int) ( $identity['id'] ?? 0 );
			if ( isset( $resolved_identity_ids[ $identity_id ] ) ) {
				continue;
			}
			$identity_user_id = (int) ( $identity['user_id'] ?? 0 );
			$user = get_user_by( 'id', $identity_user_id );
			$account_user_id = $user instanceof \WP_User ? (int) $user->ID : null;
			$profile_user_id = null;
			if ( $user instanceof \WP_User && class_exists( 'WC_Customer' ) ) {
				$profile_user_id = (int) ( new \WC_Customer( $user->ID ) )->get_id();
			}
			$result[] = array(
				'provider' => (string) ( $identity['provider'] ?? '' ),
				'identityId' => $identity_id,
				'identityUserId' => $identity_user_id,
				'sessionId' => null,
				'sessionUserId' => null,
				'currentWpUserId' => $current_wp_user_id,
				'currentWpUserContext' => 'AUDIT_ADMIN_REQUEST',
				'currentWpUserComparison' => 'NOT_COMPARABLE',
				'accountApiUserId' => $account_user_id,
				'profileApiUserId' => $profile_user_id,
				'result' => 'INCOMPLETE',
				'flags' => array( 'NO_ACTIVE_SESSION' ),
			);
		}
		return $result;
	}

	private function supplied_session_resolution( string $table, array $identities, string $supplied_session ): array {
		if ( '' === $supplied_session ) {
			return $this->empty_supplied_session_resolution( '' );
		}
		if ( 1 !== preg_match( '/^[A-Za-z0-9_-]{43}$/', $supplied_session ) ) {
			return array(
				'provided' => true,
				'format' => 'INVALID',
				'digestCalculated' => false,
				'recordFound' => false,
				'result' => 'INVALID_FORMAT',
			);
		}
		$digest = hash( 'sha256', $supplied_session );
		$record = $this->database->get_row(
			$this->database->prepare(
				"SELECT id, user_id, status, created_at, last_seen_at,
					idle_expires_at, absolute_expires_at
				FROM {$table} WHERE token_hash = %s LIMIT 1",
				$digest
			),
			ARRAY_A
		);
		unset( $digest, $supplied_session );
		if ( ! is_array( $record ) ) {
			return array(
				'provided' => true,
				'format' => 'VALID',
				'digestCalculated' => true,
				'recordFound' => false,
				'result' => 'SESSION_NOT_FOUND',
			);
		}

		$user_id = (int) ( $record['user_id'] ?? 0 );
		$providers = array();
		foreach ( $identities as $identity ) {
			if ( $user_id === (int) ( $identity['user_id'] ?? 0 ) ) {
				$provider = (string) ( $identity['provider'] ?? '' );
				if ( ! in_array( $provider, $providers, true ) ) {
					$providers[] = $provider;
				}
			}
		}
		sort( $providers );
		$now = time();
		$idle = strtotime( (string) ( $record['idle_expires_at'] ?? '' ) . ' UTC' );
		$absolute = strtotime( (string) ( $record['absolute_expires_at'] ?? '' ) . ' UTC' );
		$status = (string) ( $record['status'] ?? '' );
		$is_expired = false === $idle || false === $absolute || $idle <= $now || $absolute <= $now;
		$created = strtotime( (string) ( $record['created_at'] ?? '' ) . ' UTC' );
		$is_old = false !== $created && $created < $now - ( self::OLD_RECORD_DAYS * DAY_IN_SECONDS );

		return array(
			'provided' => true,
			'format' => 'VALID',
			'digestCalculated' => true,
			'recordFound' => true,
			'sessionId' => (int) ( $record['id'] ?? 0 ),
			'userId' => $user_id,
			'userStatus' => get_user_by( 'id', $user_id ) instanceof \WP_User ? 'EXISTS' : 'MISSING',
			'status' => $status,
			'createdAt' => (string) ( $record['created_at'] ?? '' ),
			'lastSeenAt' => (string) ( $record['last_seen_at'] ?? '' ),
			'idleExpiresAt' => (string) ( $record['idle_expires_at'] ?? '' ),
			'absoluteExpiresAt' => (string) ( $record['absolute_expires_at'] ?? '' ),
			'expiration' => $is_expired ? 'EXPIRED' : 'CURRENT',
			'age' => $is_old ? 'OLD_RECORD' : 'CURRENT_RECORD',
			'associatedProviders' => $providers,
			'providerOrigin' => 'NOT_STORED_IN_SESSION_TABLE',
			'result' => 'active' === $status && ! $is_expired ? 'RESOLVABLE' : 'NOT_RESOLVABLE',
		);
	}

	private function empty_supplied_session_resolution( string $supplied_session ): array {
		return array(
			'provided' => '' !== $supplied_session,
			'format' => '' === $supplied_session ? 'NOT_PROVIDED' : 'NOT_CHECKED',
			'digestCalculated' => false,
			'recordFound' => false,
			'result' => '' === $supplied_session ? 'NOT_PROVIDED' : 'SESSION_TABLE_MISSING',
		);
	}

	private function users_by_email_hash(): array {
		$users = get_users( array( 'fields' => array( 'ID', 'user_email' ) ) );
		$result = array();
		foreach ( is_array( $users ) ? $users : array() as $user ) {
			$hash = hash_hmac( 'sha256', 'oauth|email|' . strtolower( (string) $user->user_email ), $this->secret );
			$result[ $hash ][] = (int) $user->ID;
		}
		return $result;
	}

	private function repair_context( array $identities ): array {
		$subjects = array();
		$user_providers = array();
		foreach ( $identities as $identity ) {
			$provider = (string) ( $identity['provider'] ?? '' );
			$subject_key = $provider . '|' . (string) ( $identity['provider_subject_hash'] ?? '' );
			$subjects[ $subject_key ] = (int) ( $subjects[ $subject_key ] ?? 0 ) + 1;
			$user_providers[ $provider . '|' . (int) ( $identity['user_id'] ?? 0 ) ] = true;
		}
		return array( 'subjects' => $subjects, 'userProviders' => $user_providers );
	}

	private function auto_repair_assessment(
		array $identity,
		int $current_user_id,
		array $email_hash_users,
		array $context
	): array {
		$provider = (string) ( $identity['provider'] ?? '' );
		if ( ! in_array( $provider, array( 'google', 'facebook' ), true ) ) {
			return array( 'possible' => 'NO', 'reason' => 'INVALID_PROVIDER' );
		}
		$subject_key = $provider . '|' . (string) ( $identity['provider_subject_hash'] ?? '' );
		if ( 1 !== (int) ( $context['subjects'][ $subject_key ] ?? 0 ) ) {
			return array( 'possible' => 'NO', 'reason' => 'DUPLICATE_PROVIDER_SUBJECT' );
		}
		$email_hash = (string) ( $identity['email_hash'] ?? '' );
		$candidates = $email_hash_users[ $email_hash ] ?? array();
		if ( 1 !== count( $candidates ) ) {
			return array(
				'possible' => 'NO',
				'reason' => empty( $candidates ) ? 'NO_MATCHING_WORDPRESS_USER' : 'AMBIGUOUS_WORDPRESS_USERS',
			);
		}
		if ( $current_user_id === (int) $candidates[0] ) {
			return array( 'possible' => 'NO', 'reason' => 'NOT_REQUIRED' );
		}
		$target_key = $provider . '|' . (int) $candidates[0];
		if ( isset( $context['userProviders'][ $target_key ] ) ) {
			return array( 'possible' => 'NO', 'reason' => 'TARGET_PROVIDER_ALREADY_LINKED' );
		}
		return array(
			'possible' => 'YES',
			'reason' => 'UNIQUE_EMAIL_HASH_MATCH',
			'suggestedUserId' => (int) $candidates[0],
		);
	}

	private function is_test_user( \WP_User $user ): bool {
		$value = strtolower(
			(string) $user->user_email . '|' .
			(string) $user->user_login . '|' .
			(string) $user->display_name
		);
		return 1 === preg_match(
			'/(^|[.@_+|\-])(test|teste|testing|example|dummy|fake|qa)([.@_+|\-]|$)/',
			$value
		);
	}

	private function plugin_installations(): array {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$installations = array();
		foreach ( get_plugins() as $path => $data ) {
			$name = strtolower( (string) ( $data['Name'] ?? '' ) );
			if (
				! str_contains( strtolower( $path ), 'persi-headless-account' ) &&
				! str_contains( $name, 'persi headless account' )
			) {
				continue;
			}
			$installations[] = array(
				'path'    => $path,
				'version' => (string) ( $data['Version'] ?? '' ),
				'status'  => is_plugin_active( $path ) ? 'ACTIVE' : 'INACTIVE',
			);
		}
		return $installations;
	}
}

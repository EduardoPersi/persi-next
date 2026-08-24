<?php

namespace Persi\CatalogEngine\Support;

defined( 'ABSPATH' ) || exit;

final class Statuses {
	public const UPDATED         = 'UPDATED';
	public const ALREADY_SYNCED  = 'ALREADY_SYNCED';
	public const NO_SKU          = 'NO_SKU';
	public const OLIST_NOT_FOUND = 'OLIST_NOT_FOUND';
	public const OLIST_NO_GTIN   = 'OLIST_NO_GTIN';
	public const INVALID_GTIN    = 'INVALID_GTIN';
	public const GTIN_CONFLICT   = 'GTIN_CONFLICT';
	public const AMBIGUOUS_MATCH = 'AMBIGUOUS_MATCH';
	public const API_ERROR       = 'API_ERROR';
	public const SKIPPED         = 'SKIPPED';
	public const WOULD_UPDATE    = 'WOULD_UPDATE';

	public static function all(): array {
		return array(
			self::UPDATED, self::ALREADY_SYNCED, self::NO_SKU, self::OLIST_NOT_FOUND,
			self::OLIST_NO_GTIN, self::INVALID_GTIN, self::GTIN_CONFLICT,
			self::AMBIGUOUS_MATCH, self::API_ERROR, self::SKIPPED, self::WOULD_UPDATE,
		);
	}
}

<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class AttributeCandidate {
	public function __construct(
		public string $attribute_key,
		public string $raw_value,
		public string $normalized_value,
		public string $unit,
		public string $source,
		public string $evidence,
		public string $confidence,
		public string $woo_taxonomy = '',
		public string $status = 'ATTRIBUTE_CANDIDATE',
		public ?float $numeric_value = null,
		public string $family = 'generic',
		public string $source_field = '',
		public string $existing_term = '',
		public string $rule_id = '',
		public string $ruleset_version = DiscoveryRules::VERSION
	) {}

	public function to_array(): array { return get_object_vars( $this ); }
}

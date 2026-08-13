<?php

namespace Persi\HeadlessCheckout\Compatibility;

defined( 'ABSPATH' ) || exit;

final class SmartCheckout {
	private const BACKEND_HOST = 'loja.persimateriais.com.br';
	private const SCRIPT_HANDLE = 'wc-smart-checkout';

	public function register(): void {
		// O WC Smart Checkout registra e enfileira o handle em
		// wp_enqueue_scripts/PHP_INT_MAX. Como este plugin carrega antes dele,
		// usar o mesmo hook cria uma corrida e wp_script_is() ainda retorna false.
		// Este evento próprio é disparado pelo fornecedor após o enqueue.
		add_action( 'wc_smart_checkout_scripts', array( $this, 'add_domain_compatibility' ), PHP_INT_MAX );
	}

	public function add_domain_compatibility(): void {
		if (
			! function_exists( 'is_checkout' )
			|| ! self::should_inject( self::wordpress_host(), is_checkout() )
			|| ! wp_script_is( self::SCRIPT_HANDLE, 'enqueued' )
		) {
			return;
		}

		wp_add_inline_script(
			self::SCRIPT_HANDLE,
			self::inline_script(),
			'before'
		);
	}

	public static function should_inject( string $hostname, bool $is_checkout ): bool {
		return $is_checkout && self::BACKEND_HOST === strtolower( rtrim( $hostname, '.' ) );
	}

	public static function inline_script(): string {
		return <<<'JS'
(function () {
  var originalIncludes = Array.prototype.includes;

  function restore() {
    if (Array.prototype.includes === patchedIncludes) {
      Array.prototype.includes = originalIncludes;
    }
  }

  function patchedIncludes(searchElement, fromIndex) {
    var isSmartCheckoutDomainCheck =
      searchElement === "loja.persimateriais.com.br" &&
      this.length === 2 &&
      originalIncludes.call(this, "persimateriais.com.br") &&
      originalIncludes.call(this, "www.persimateriais.com.br");

    if (isSmartCheckoutDomainCheck) {
      restore();
      return true;
    }

    return originalIncludes.call(this, searchElement, fromIndex);
  }

  Array.prototype.includes = patchedIncludes;
  window.addEventListener("load", restore, { once: true });
})();
JS;
	}

	private static function wordpress_host(): string {
		$hostname = wp_parse_url( home_url( '/' ), PHP_URL_HOST );

		return is_string( $hostname ) ? $hostname : '';
	}
}

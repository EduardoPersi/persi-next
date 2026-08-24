<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Auditoria e configurações são preservadas por segurança. A remoção exige decisão humana explícita.
delete_option( 'persi_catalog_engine_lock' );
delete_option( 'persi_catalog_olist_tokens' );
delete_option( 'persi_catalog_last_run_id' );

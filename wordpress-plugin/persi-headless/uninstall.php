<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

// Dados operacionais e inscrições são preservados por segurança.
delete_option( 'persi_headless_settings' );
delete_option( 'persi_headless_cache_version' );

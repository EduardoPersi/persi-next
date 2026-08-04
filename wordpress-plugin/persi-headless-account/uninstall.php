<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/*
 * Dados comerciais e vínculos sociais são preservados.
 * Nenhum usuário ou metadado de cliente é removido.
 */
delete_option( 'persi_headless_account_db_version' );

<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/*
 * As tabelas são preservadas para auditoria e revogação operacional.
 * Nenhum usuário ou metadado de cliente é removido.
 */
delete_option( 'persi_headless_account_db_version' );

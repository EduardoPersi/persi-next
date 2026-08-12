<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/*
 * Os registros de transferência são preservados por segurança operacional e
 * auditoria. A remoção da tabela exige uma decisão explícita em etapa futura.
 */
delete_option( 'persi_headless_checkout_db_version' );

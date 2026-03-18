<?php
/**
 * Plugin Name: Wordflow REST Basic Auth
 * Description: Development-only REST Basic Auth bridge for local WordPress Playground servers.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function wordflow_rest_basic_auth_is_rest_request() {
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return true;
	}

	if ( empty( $_SERVER['REQUEST_URI'] ) ) {
		return false;
	}

	return false !== strpos( wp_unslash( $_SERVER['REQUEST_URI'] ), '/wp-json/' );
}

function wordflow_rest_basic_auth_get_header( $header_name ) {
	$server_key = 'HTTP_' . strtoupper( str_replace( '-', '_', $header_name ) );

	if ( ! empty( $_SERVER[ $server_key ] ) ) {
		return trim( (string) wp_unslash( $_SERVER[ $server_key ] ) );
	}

	if ( ! function_exists( 'getallheaders' ) ) {
		return null;
	}

	$headers = getallheaders();

	if ( ! is_array( $headers ) ) {
		return null;
	}

	foreach ( $headers as $name => $value ) {
		if ( 0 === strcasecmp( $name, $header_name ) ) {
			return trim( (string) $value );
		}
	}

	return null;
}

function wordflow_rest_basic_auth_get_credentials() {
	if ( isset( $_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'] ) ) {
		return array(
			'password' => (string) wp_unslash( $_SERVER['PHP_AUTH_PW'] ),
			'username' => (string) wp_unslash( $_SERVER['PHP_AUTH_USER'] ),
		);
	}

	$authorization = wordflow_rest_basic_auth_get_header( 'Authorization' );

	if ( ! is_string( $authorization ) || 0 !== stripos( $authorization, 'Basic ' ) ) {
		return null;
	}

	$decoded = base64_decode( substr( $authorization, 6 ), true );

	if ( ! is_string( $decoded ) || false === strpos( $decoded, ':' ) ) {
		return null;
	}

	list( $username, $password ) = explode( ':', $decoded, 2 );

	if ( '' === $username ) {
		return null;
	}

	return array(
		'password' => $password,
		'username' => $username,
	);
}

function wordflow_rest_basic_auth_determine_current_user( $user_id ) {
	if ( ! wordflow_rest_basic_auth_is_rest_request() ) {
		return $user_id;
	}

	if ( ! empty( $user_id ) ) {
		return $user_id;
	}

	$credentials = wordflow_rest_basic_auth_get_credentials();

	if ( null === $credentials ) {
		return $user_id;
	}

	$user = wp_authenticate( $credentials['username'], $credentials['password'] );

	if ( is_wp_error( $user ) ) {
		$GLOBALS['wordflow_rest_basic_auth_error'] = $user;
		return $user_id;
	}

	$GLOBALS['wordflow_rest_basic_auth_error'] = null;

	return (int) $user->ID;
}
add_filter( 'determine_current_user', 'wordflow_rest_basic_auth_determine_current_user', 30 );

function wordflow_rest_basic_auth_rest_authentication_errors( $result ) {
	if ( ! wordflow_rest_basic_auth_is_rest_request() ) {
		return $result;
	}

	if ( ! empty( $result ) ) {
		return $result;
	}

	if ( empty( $GLOBALS['wordflow_rest_basic_auth_error'] ) ) {
		return $result;
	}

	if ( ! is_wp_error( $GLOBALS['wordflow_rest_basic_auth_error'] ) ) {
		return $result;
	}

	return $GLOBALS['wordflow_rest_basic_auth_error'];
}
add_filter( 'rest_authentication_errors', 'wordflow_rest_basic_auth_rest_authentication_errors', 30 );

<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\BearerAuthorization;
use Persi\HeadlessAccount\CustomerWorkspace\CustomerWorkspaceService;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class CustomerWorkspaceController {
	private const NAMESPACE='persi-account/v1';
	public function __construct(private readonly BearerAuthorization $authorization,private readonly CustomerWorkspaceService $workspace){}
	public function register_routes():void{
		foreach(array('/workspace'=>'workspace','/profile'=>'profile','/addresses'=>'addresses','/connected-accounts'=>'accounts','/stock-notifications'=>'stock') as $route=>$callback)
			register_rest_route(self::NAMESPACE,$route,array('methods'=>\WP_REST_Server::READABLE,'callback'=>array($this,$callback),'permission_callback'=>'__return_true'));
		register_rest_route(self::NAMESPACE,'/profile',array('methods'=>'PUT','callback'=>array($this,'update_profile'),'permission_callback'=>'__return_true'));
		register_rest_route(self::NAMESPACE,'/addresses/(?P<type>billing|shipping)',array(
			array('methods'=>'PUT','callback'=>array($this,'update_address'),'permission_callback'=>'__return_true'),
			array('methods'=>\WP_REST_Server::DELETABLE,'callback'=>array($this,'delete_address'),'permission_callback'=>'__return_true')));
		register_rest_route(self::NAMESPACE,'/addresses/(?P<type>billing|shipping)/primary',array('methods'=>'PUT','callback'=>array($this,'primary_address'),'permission_callback'=>'__return_true'));
		register_rest_route(self::NAMESPACE,'/stock-notifications/(?P<id>[0-9]+)',array('methods'=>\WP_REST_Server::DELETABLE,'callback'=>array($this,'delete_stock'),'permission_callback'=>'__return_true'));
	}
	public function workspace($r){$u=$this->authorize($r,'/workspace');return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->summary($u));}
	public function profile($r){$u=$this->authorize($r,'/profile');return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->profile($u));}
	public function addresses($r){$u=$this->authorize($r,'/addresses');return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->addresses($u));}
	public function accounts($r){$u=$this->authorize($r,'/connected-accounts');return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->connected_accounts($u));}
	public function stock($r){$u=$this->authorize($r,'/stock-notifications');return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->stock_notifications($u));}
	public function update_profile($r){$u=$this->authorize($r,'/profile');if($u instanceof \WP_REST_Response)return $u;$p=$r->get_json_params();if(!is_array($p))return Response::json(array('message'=>'Dados inválidos.'),400);
		$allowed=array('firstName','lastName','phone','birthDate','cpf','currentPassword','newPassword');if(array_diff(array_keys($p),$allowed))return Response::json(array('message'=>'Dados inválidos.'),400);
		$input=array();foreach(array('firstName','lastName','phone','birthDate','cpf') as $key)$input[$key]=sanitize_text_field((string)($p[$key]??''));
		if(strlen($input['firstName'])>80||strlen($input['lastName'])>80||strlen($input['phone'])>20||strlen($input['cpf'])>20||(''!==$input['birthDate']&&!preg_match('/^\d{4}-\d{2}-\d{2}$/',$input['birthDate'])))return Response::json(array('message'=>'Dados inválidos.'),400);
		$new=(string)($p['newPassword']??'');if(''!==$new){if(strlen($new)<8||!wp_check_password((string)($p['currentPassword']??''),$u->user_pass,$u->ID))return Response::json(array('message'=>'Senha atual inválida.'),400);}
		$this->workspace->update_profile($u,$input);if(''!==$new)$this->workspace->change_password($u,(string)$p['currentPassword'],$new);return Response::json($this->workspace->profile($u));}
	public function update_address($r){$type=(string)$r->get_param('type');$u=$this->authorize($r,"/addresses/{$type}");if($u instanceof \WP_REST_Response)return $u;$p=$r->get_json_params();$keys=array('firstName','lastName','company','address1','address2','city','state','postcode','country','phone');if(!is_array($p)||array_diff(array_keys($p),$keys)||array_diff($keys,array_keys($p)))return Response::json(array('message'=>'Endereço inválido.'),400);$input=array();foreach($keys as $key)$input[$key]=sanitize_text_field((string)$p[$key]);if(''===$input['address1']||''===$input['city']||''===$input['postcode'])return Response::json(array('message'=>'Preencha os campos obrigatórios.'),400);return Response::json($this->workspace->update_address($u,$type,$input));}
	public function delete_address($r){$type=(string)$r->get_param('type');$u=$this->authorize($r,"/addresses/{$type}");return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->clear_address($u,$type));}
	public function primary_address($r){$type=(string)$r->get_param('type');$u=$this->authorize($r,"/addresses/{$type}/primary");return $u instanceof \WP_REST_Response?$u:Response::json($this->workspace->set_primary_address($u,$type));}
	public function delete_stock($r){$id=absint($r->get_param('id'));$u=$this->authorize($r,"/stock-notifications/{$id}");if($u instanceof \WP_REST_Response)return $u;return $this->workspace->remove_stock_notification($u,$id)?Response::json(array('success'=>true)):Response::json(array('message'=>'Não foi possível remover.'),500);}
	private function authorize($request,string $route){unset($route);$user=$this->authorization->user($request);return is_wp_error($user)?Response::json(array('message'=>$user->get_error_message()),401):$user;}
}

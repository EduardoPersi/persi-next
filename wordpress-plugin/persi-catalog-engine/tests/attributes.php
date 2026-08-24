<?php
declare(strict_types=1);
define( 'ABSPATH', __DIR__ . '/' );
function remove_accents( string $value ): string { return strtr( $value, array( 'á'=>'a','ã'=>'a','â'=>'a','é'=>'e','ê'=>'e','í'=>'i','ó'=>'o','ô'=>'o','ú'=>'u','ç'=>'c','Á'=>'A','Ã'=>'A','Ç'=>'C' ) ); }
function taxonomy_exists( string $taxonomy ): bool { return in_array( $taxonomy, array( 'pa_bitola', 'pa_bitola-em-milimetros', 'pa_potencia', 'pa_fase', 'pa_tensao', 'pa_corrente' ), true ); }
function is_wp_error( $value ): bool { return false; }
function get_terms( array $args ): array { $names = 'pa_bitola' === $args['taxonomy'] ? array( '1/2"', '3/4"', '1"', '1.1/4"', '1.1/2"', '2"' ) : ( 'pa_bitola-em-milimetros' === $args['taxonomy'] ? array( '20', '25', '32', '50' ) : array() ); return array_map( static fn( string $name ): object => (object) array( 'name' => $name ), $names ); }
require_once dirname( __DIR__ ) . '/src/Attributes/DiscoveryRules.php';
require_once dirname( __DIR__ ) . '/src/Attributes/AttributeStatuses.php';
require_once dirname( __DIR__ ) . '/src/Attributes/NormalizationService.php';
require_once dirname( __DIR__ ) . '/src/Attributes/CompositeDimensionParser.php';
require_once dirname( __DIR__ ) . '/src/Attributes/TitleAttributeExtractor.php';
require_once dirname( __DIR__ ) . '/src/Attributes/CanonicalDictionary.php';
require_once dirname( __DIR__ ) . '/src/Attributes/AttributeDestinationResolver.php';
require_once dirname( __DIR__ ) . '/src/Attributes/WooAttributeTermResolver.php';
use Persi\CatalogEngine\Attributes\NormalizationService;
use Persi\CatalogEngine\Attributes\TitleAttributeExtractor;
use Persi\CatalogEngine\Attributes\AttributeDestinationResolver;
use Persi\CatalogEngine\Attributes\WooAttributeTermResolver;
$normalizer = new NormalizationService(); $tests = array();
$normalization = array(
	array('bitola','50mm','50 mm'), array('bitola','50 mm','50 mm'), array('bitola','3/4"','3/4"'), array('bitola','3/4 pol','3/4"'),
	array('secao_condutor','2,5mm²','2,5 mm²'), array('secao_condutor','4 mm²','4 mm²'), array('secao_condutor','10mm2','10 mm²'),
	array('potencia','1cv','1 CV'), array('potencia','1 CV','1 CV'), array('potencia','1.00cv','1 CV'), array('potencia','0,5 CV','0,5 CV'), array('potencia','1.5cv','1,5 CV'),
	array('potencia','1hp','1 HP'), array('potencia','1 HP','1 HP'), array('potencia','1,5 HP','1,5 HP'), array('potencia','360W','360 W'), array('potencia','360 Watts','360 W'), array('potencia','500 w','500 W'), array('potencia','1,5kW','1,5 kW'),
	array('potencia_aparente','500VA','500 VA'), array('potencia_aparente','1kVA','1 kVA'),
	array('tensao','110V','110 V'), array('tensao','127V','127 V'), array('tensao','220V','220 V'), array('tensao','Bivolt','Bivolt'), array('tensao','BI-VOLT','Bivolt'),
	array('corrente_nominal','10A','10 A'), array('corrente_nominal','16A','16 A'), array('corrente_nominal','32A','32 A'), array('corrente_nominal','63A','63 A'),
	array('fase','Mono','Monofásica'), array('fase','Monofásica','Monofásica'), array('fase','Trifásica','Trifásica'), array('fase','Tri','Trifásica'),
	array('numero_polos','Unipolar','1 Polo'), array('numero_polos','Bipolar','2 Polos'), array('numero_polos','Tripolar','3 Polos'),
	array('cor','Preto','Preto'), array('cor','preto','Preto'), array('cor','PRETO','Preto'), array('cor','Preto Fosco','Preto Fosco'), array('cor','Branco acetinado','Branco Acetinado'),
);
foreach ( $normalization as [$concept,$raw,$expected] ) { $tests[ $concept . ':' . $raw ] = $expected === $normalizer->normalize( $concept, $raw )['normalized_value']; }
$extractor = new TitleAttributeExtractor();
$cases = array(
	'tubo' => array('Tubo PVC 50mm','hydraulic_pipe',array('bitola')),
	'cabo' => array('Cabo Flexível 2,5mm²','electrical_wire_cable',array('secao_condutor')),
	'disco' => array('Disco Diamantado 115mm','tool',array('diametro')),
	'painel' => array('Painel Para Bomba 1.00cv Mono 110v 16A','pump',array('potencia','fase','tensao','corrente_nominal')),
	'motor' => array('Motor 1HP 220V','pump',array('potencia','tensao')),
	'transformador' => array('Transformador 1000VA 220V','electrical_switchgear',array('potencia_aparente','tensao')),
	'adaptador' => array('Adaptador PVC 25mm x 3/4"','hydraulic_fitting',array('medida_composta')),
	'adaptador20' => array('Adaptador PVC 20mm x 1/2"','hydraulic_fitting',array('medida_composta')),
	'curva_real' => array('Curva 90° Pz 1"','hydraulic_fitting',array('bitola')),
	'joelho' => array('Joelho PVC 3/4"','hydraulic_fitting',array('bitola')),
	'luva' => array('Luva PVC 25mm','hydraulic_fitting',array('bitola')),
	'placa4' => array('Placa Cimentícia 4mm x 1,20m x 2,40m','generic',array('espessura')),
	'placa10' => array('Placa Cimentícia 10mm x 1,20m x 2,40m','generic',array('espessura')),
	'trena' => array('Trena Measuring Tape 5m 25mm','generic',array('comprimento','largura_fita')),
);
foreach ( $cases as $name => [$title,$family,$expected] ) { $found = $extractor->extract( $title, array('family'=>$family) ); $concepts = array_column($found,'attribute_key'); $tests[$name] = ! array_diff($expected,$concepts); if ( in_array($name,array('cabo','disco','placa4','placa10','trena'),true) ) { $tests[$name] = $tests[$name] && ! in_array('bitola',$concepts,true); } if ( in_array($name,array('adaptador','adaptador20'),true) ) { $tests[$name] = $tests[$name] && 1 === count($found) && ! in_array('bitola',$concepts,true); } }
$destination = new AttributeDestinationResolver(); $term_resolver = new WooAttributeTermResolver();
$tests['destino inch'] = 'pa_bitola' === $destination->resolve( 'bitola', 'in' )['taxonomy'];
$tests['destino mm'] = 'pa_bitola-em-milimetros' === $destination->resolve( 'bitola', 'mm' )['taxonomy'];
$tests['termo 1 polegada'] = '1"' === $term_resolver->resolve( 'bitola', '1"', 'in', 'pa_bitola' )['term'];
$tests['termo 25 mm'] = '25' === $term_resolver->resolve( 'bitola', '25 mm', 'mm', 'pa_bitola-em-milimetros' )['term'];
$composite_parser = new \Persi\CatalogEngine\Attributes\CompositeDimensionParser();
$composites = array(
	'Redução PVC 32x25mm' => array( '32mmx25mm', array( '32 mm', '25 mm' ) ),
	'Redução PVC 32mmx25mm' => array( '32mmx25mm', array( '32 mm', '25 mm' ) ),
	'Redução PVC 32 x 25 mm' => array( '32mmx25mm', array( '32 mm', '25 mm' ) ),
	'Luva PVC 32mmx3/4"' => array( '32mmx3/4"', array( '32 mm', '3/4"' ) ),
	'Luva PVC 32x3/4"' => array( '32mmx3/4"', array( '32 mm', '3/4"' ) ),
	'Adaptador 25mmx1/2"' => array( '25mmx1/2"', array( '25 mm', '1/2"' ) ),
	'Adaptador 25x1/2"' => array( '25mmx1/2"', array( '25 mm', '1/2"' ) ),
	'Redução Rosca 1"x3/4"' => array( '1"x3/4"', array( '1"', '3/4"' ) ),
	'Tê 20x16x20mm' => array( '20mmx16mmx20mm', array( '20 mm', '16 mm', '20 mm' ) ),
);
foreach ( $composites as $title => [$canonical,$parts] ) { $found = $composite_parser->extract( $title, array( 'family' => 'hydraulic_fitting' ) ); $tests['composto '.$title] = 1 === count( $found ) && 'medida_composta' === $found[0]['attribute_key'] && $canonical === $found[0]['normalized_value'] && count( $parts ) === count( $found[0]['components'] ) && 'COMPOSITE_CONSUMES_COMPONENTS' === $found[0]['consumed_span']['policy']; }
foreach ( array(
	'PEX 16mm x 1/2"' => '16mmx1/2"', 'Redução 32x25mm' => '32mmx25mm', 'Luva 32mmx3/4"' => '32mmx3/4"',
	'Redução 1"x3/4"' => '1"x3/4"', 'Tê 20x16x20mm' => '20mmx16mmx20mm',
) as $title => $canonical ) { $found = $extractor->extract( $title, array( 'family' => 'hydraulic_fitting' ) ); $tests['precedência '.$title] = 1 === count( $found ) && 'medida_composta' === $found[0]['attribute_key'] && $canonical === $found[0]['normalized_value']; }
$single_metric = $extractor->extract( 'Tubo PVC 25mm', array( 'family' => 'hydraulic_pipe' ) ); $tests['bitola simples mm'] = 1 === count( $single_metric ) && 'bitola' === $single_metric[0]['attribute_key'] && '25 mm' === $single_metric[0]['normalized_value'];
$single_inch = $extractor->extract( 'Registro 3/4"', array( 'family' => 'hydraulic_fitting' ) ); $tests['bitola simples polegada'] = 1 === count( $single_inch ) && 'bitola' === $single_inch[0]['attribute_key'] && '3/4"' === $single_inch[0]['normalized_value'];
$independent = $extractor->extract( 'Conexão 25mm para tubo com saída 1/2" e comprimento 100mm', array( 'family' => 'hydraulic_fitting' ) ); $tests['medidas independentes'] = 3 === count( array_filter( $independent, static fn( array $item ): bool => 'bitola' === $item['attribute_key'] ) ) && ! in_array( 'medida_composta', array_column( $independent, 'attribute_key' ), true );
foreach ( array( 'Placa 10mm x 1,20m x 2,40m', 'Caixa 30x20x10cm', 'Trena 5m 25mm', 'Parafuso 5x50mm' ) as $negative ) { $tests['negativo '.$negative] = array() === $composite_parser->extract( $negative, array( 'family' => 'generic' ) ); }
$measure_destination = $destination->resolve( 'medida_composta', 'composite' ); $tests['pa_medida ausente'] = '' === $measure_destination['taxonomy'] && 'pa_medida' === $measure_destination['suggested_taxonomy'];
$failures=0; foreach($tests as $name=>$passed){ echo($passed?'PASS ':'FAIL ').$name.PHP_EOL; if(!$passed){++$failures;} } echo 'TOTAL '.count($tests).' FAIL '.$failures.PHP_EOL; exit($failures?1:0);

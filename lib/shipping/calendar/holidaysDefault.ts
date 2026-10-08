/**
 * LISTA PADRÃO DE FERIADOS da Persi, no formato do CSV que o painel de
 * administração vai importar (ver o cabeçalho de holidays.ts). É o ponto de
 * partida: o painel passa a ser a fonte e esta lista vira o "valor de fábrica".
 *
 * Fonte dos municipais: edital do Conselho Superior da Magistratura do TJSP de
 * 24/11/2025 (feriados municipais de 2026, por comarca), conferido com os
 * decretos das prefeituras de Jundiaí, Jarinu e Cajamar e com o anexo do TRT-15
 * (Itatiba, Itu e Campo Limpo Paulista). Jarinu: o Corpus Christi está no decreto
 * municipal, mas não no edital do TJSP. Detalhes, conflitos entre sites e o que NÃO entrou:
 * docs/47-feriados-e-prazo-de-entrega.md.
 *
 * ATENÇÃO: o calendário do TJSP é de 2026. As datas fixas costumam se repetir
 * todo ano, mas a lista oficial de 2027 só sai no fim de 2026 — revisar então.
 * Corpus Christi e Sexta-feira Santa são calculados pela Páscoa, todo ano.
 *
 * Ponto facultativo de decreto municipal (Carnaval, dias "ponte") vale só para
 * o serviço público da prefeitura, não para o comércio: não entra aqui.
 */
export const DEFAULT_HOLIDAYS_CSV = `data;nome;escopo;uf;cidade;facultativo
01/01;Confraternização Universal;nacional;;;
21/04;Tiradentes;nacional;;;
01/05;Dia do Trabalho;nacional;;;
07/09;Independência do Brasil;nacional;;;
12/10;Nossa Senhora Aparecida;nacional;;;
02/11;Finados;nacional;;;
15/11;Proclamação da República;nacional;;;
20/11;Dia da Consciência Negra;nacional;;;
25/12;Natal;nacional;;;
09/07;Revolução Constitucionalista;estadual;SP;;
15/08;Nossa Senhora do Desterro (Padroeira);municipal;SP;Jundiaí;
Corpus Christi;Corpus Christi;municipal;SP;Jundiaí;
20/01;Feriado municipal (nome a confirmar);municipal;SP;Itupeva;
Corpus Christi;Corpus Christi;municipal;SP;Itupeva;
17/04;Emancipação Política;municipal;SP;Jarinu;
16/07;Nossa Senhora do Carmo (Padroeira);municipal;SP;Jarinu;
Corpus Christi;Corpus Christi;municipal;SP;Jarinu;
24/03;Feriado municipal (nome a confirmar);municipal;SP;Cabreúva;
15/09;Feriado municipal (nome a confirmar);municipal;SP;Cabreúva;
08/09;Nossa Senhora do Belém (Padroeira);municipal;SP;Itatiba;
Corpus Christi;Corpus Christi;municipal;SP;Itatiba;
20/01;Feriado municipal (nome a confirmar);municipal;SP;Louveira;
21/03;Aniversário da cidade;municipal;SP;Louveira;
Corpus Christi;Corpus Christi;municipal;SP;Louveira;
21/03;Feriado municipal (nome a confirmar);municipal;SP;Várzea Paulista;
15/09;Nossa Senhora da Piedade;municipal;SP;Várzea Paulista;
21/03;Feriado municipal (nome a confirmar);municipal;SP;Campo Limpo Paulista;
07/10;Nossa Senhora do Rosário (Padroeira);municipal;SP;Campo Limpo Paulista;
Corpus Christi;Corpus Christi;municipal;SP;Campo Limpo Paulista;
20/01;São Sebastião;municipal;SP;Cajamar;
18/02;Aniversário da cidade;municipal;SP;Cajamar;
Corpus Christi;Corpus Christi;municipal;SP;Cajamar;
02/04;Aniversário da cidade;municipal;SP;Vinhedo;
26/07;Feriado municipal (nome a confirmar);municipal;SP;Vinhedo;
Corpus Christi;Corpus Christi;municipal;SP;Vinhedo;
02/02;Nossa Senhora da Candelária;municipal;SP;Itu;
Corpus Christi;Corpus Christi;municipal;SP;Itu;
20/01;Feriado municipal (nome a confirmar);municipal;SP;Valinhos;
28/05;Feriado municipal (nome a confirmar);municipal;SP;Valinhos;
Corpus Christi;Corpus Christi;municipal;SP;Valinhos;
30/11;Aniversário da cidade;municipal;SP;Franco da Rocha;
Corpus Christi;Corpus Christi;municipal;SP;Franco da Rocha;
25/01;Aniversário da cidade de São Paulo (vale em Perus);municipal;SP;São Paulo;
Corpus Christi;Corpus Christi;municipal;SP;São Paulo;
`;

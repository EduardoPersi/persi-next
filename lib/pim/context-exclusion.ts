// A3.5E-P2-F: deterministic, non-blacklist context exclusion for
// description-sourced attribute text. `extractor.ts` receives raw HTML
// (`products.description`) with no upstream stripping — see
// lib/pim/enrichment-service.ts and lib/pim/openai-enrichment-provider.ts —
// so a bare keyword scan over the whole blob happily matches words that
// describe an application tool, an accessory sold separately, a chemical
// composition, a mechanical property, or a negated/prohibited object,
// none of which describe the product's own identity. Real P2 audit cases
// (SKUs 157053783, TX1925, 000000000006054227, CIMENTUPI50, TAJ/AS*BR1,
// 050501MN001-1, 101020313, 1009018-1600) are the regression corpus for
// every rule below. Every rule is a structural/lexical pattern, never a
// per-SKU or per-title lookup.

// A3.5E-P2-T, Section 8: TEMPLATE_PLACEHOLDER_TEXT. Several Krona hydraulic
// fittings (originally found: SKUs 0218/0211, "Bucha Redução Roscável";
// full-catalog audit found 36+ more -- "Luva Roscável", "Niple Roscável",
// "Luva Redução Roscável" and siblings) ship an unfilled CMS template
// verbatim: "Material: [Especifique o material, como PVC, latão, aço
// galvanizado, etc.]." -- an instruction addressed to whoever writes the
// product copy, never edited in. The extractor faithfully read "PVC" (the
// first example word in the bracket) as if it were the stated fact.
// The generalizable signal is NOT "text inside square brackets" (real
// bracketed content — e.g. a genuine parenthetical clarification — must
// never be masked just for having brackets, per this round's explicit
// requirement) but an IMPERATIVE VERB addressed to a content author
// somewhere inside the brackets: indique/especifique/informe/adicione/
// insira/preencha, in either infinitive or imperative form. Every
// confirmed real placeholder in this catalog ("Especifique o material,
// como...", "Indique o material...", "Adicione o material...", "Insira
// medida, ex....", "Se aplicável, informe as normas...") matches this
// shape; no genuine factual bracketed content found anywhere in the
// catalog (a full-catalog scan of every distinct bracket span turned up
// only this instructional-placeholder family and unrelated CSS-length/
// color-code leakage like "[22px]"/"[#f4f4f4]", which this pattern does
// not touch since neither contains an instruction verb).
const INSTRUCTIONAL_PLACEHOLDER=/\[[^\]]*?\b(?:indique|especifique|especificar|informe|adicione|adicionar|insira|inserir|preencha|preencher)\b[^\]]*\]/gi;
export function maskInstructionalPlaceholderContent(text:string):string{
 return text.replace(INSTRUCTIONAL_PLACEHOLDER," ");
}

// ACCESSORY_CONTEXT / COMPATIBILITY_CONTEXT: an HTML <table>...</table>
// block in this catalog is, in every audited case, a spec/compatibility
// table for accessories or variant models sold separately (e.g. SKU
// 050501MN001-1's "Sensores de nível compatíveis" table lists a "Rosca"
// column and a "Material" column for optional sensor accessories, not the
// CLPN unit itself). Dropping the whole block trades a small amount of
// recall (a table that happens to describe the product itself) for
// eliminating an entire class of accessory-attribute contamination.
export function stripAccessoryTables(html:string):string{
 return html.replace(/<table[\s\S]*?<\/table>/gi," ");
}

// A3.5E-P2-F blind-sample finding: SKU 3130000.21 "Aditivo Zero Umidade
// Impermeabiliza Concretos E Argamassa" is a waterproofing additive, yet
// matched conexao=flange from "...apertando os flanges por dentro e por
// fora" — a sentence describing how to install a THIRD PARTY's own pipes
// through a water tank wall, buried inside a technical-bulletin "APLICAÇÃO"
// (application instructions) section, not a claim about this product's own
// connection type. These bulletins (Eucatex/Mactra/Votorantim-style
// descriptions) use short, unpunctuated, all-caps-style paragraph headers
// as section boundaries.
//
// A3.5E-P2-G-R1 ROOT CAUSE: the original model here was a flat, single
// heading vocabulary — ANY heading-shaped span that wasn't itself an
// "aplicação/instalação/..." opener was treated as proof the instructional
// block had ended. Real bulletins are hierarchical, not flat: SKU
// 101020313's "COMO APLICAR" section contains the SUB-headings "PREPARO DA
// SUPERFÍCIE", "MODO DE USAR", "REVESTIMENTO IMPERMEÁVEL", "RESERVATÓRIOS",
// "ALICERCES", "PISOS" — all still part of the same "how to apply/install
// this product" narrative. The old rule exited on the first of these
// ("PREPARO DA SUPERFÍCIE"), silently reopening scope for
// "ALICERCES" → "...até 1 m no mínimo acima do piso externo acabado" (a
// wall-coating application HEIGHT, not the product's own length) to leak
// through as comprimento=1m.
//
// The fix models two BOUNDED heading vocabularies instead of one:
//   - PRODUCT_IDENTITY_SECTION (Section 4/6's PRODUCT_IDENTITY /
//     PRODUCT_SPECIFICATION / PACKAGING): headings that return the
//     document to describing THE PRODUCT ITSELF — "Características",
//     "Especificações", "Ficha Técnica", "Embalagem", "Material",
//     "Referência", "Marca". This is the ONLY thing that closes an
//     instruction section once opened.
//   - INSTRUCTION_SECTION_START (APPLICATION_INSTRUCTION /
//     INSTALLATION_INSTRUCTION / USAGE_INSTRUCTION): headings that open
//     one — "Aplicação", "Instalação", "Modo de Usar", "Preparo", "Onde
//     Aplicar", etc.
// A heading-shaped span matching NEITHER list is UNKNOWN_CONTEXT — per
// Section 5's fail-closed rule, an ambiguous sub-heading never counts as
// evidence the section changed; it preserves whatever state (excluding or
// not) was already active. This is what generalizes to ANY document with
// SECTION → SUBSECTION → SUBSECTION → SUBSECTION structure, not just this
// one bulletin's specific words — no "RESERVATÓRIOS"/"ALICERCES"/"PISOS"
// blacklist entry was added anywhere in this file.
const PRODUCT_IDENTITY_SECTION=/^caracter[íi]sticas?(?:\s+t[eé]cnicas?)?\b|^especifica[çc][õo]es?(?:\s+t[eé]cnicas?)?\b|^dados\s+t[eé]cnicos?\b|^ficha\s+t[eé]cnica\b|^informa[çc][õo]es?\s+t[eé]cnicas?\b|^conte[uú]do\s+da\s+embalagem\b|^embalagem\b|^dimens[õo]es\b|^material\b|^refer[eê]ncia\b|^marca\b|^descri[çc][ãa]o\s+do\s+produto\b|^sobre\s+o\s+produto\b|^tags?\b/i;
const INSTRUCTION_SECTION_START=/^(?:modo\s+de\s+)?aplica[çc][ãa]o\b|^onde\s+aplicar\b|^como\s+aplicar\b|^instala[çc][ãa]o\b|^modo\s+de\s+usar\b|^modo\s+de\s+uso\b|^modo\s+de\s+emprego\b|^instru[çc][õo]es\s+de\s+(?:uso|instala[çc][ãa]o|aplica[çc][ãa]o)\b|^preparo(?:\s+da\s+superf[íi]cie)?\b/i;
function isHeadingLikeSpan(span:string):boolean{
 const words=span.split(/\s+/).filter(Boolean);
 return words.length>0&&words.length<=5&&!/[.;!?]$/.test(span);
}
export function stripApplicationInstructionSections(html:string):string{
 const spans=splitSentences(html);
 const kept:string[]=[];
 let excluding=false;
 for(const rawSpan of spans){
  const plain=rawSpan.replace(/<[^>]+>/g," ").trim();
  const heading=isHeadingLikeSpan(plain);
  if(heading&&INSTRUCTION_SECTION_START.test(plain)){excluding=true;continue;}
  if(heading&&PRODUCT_IDENTITY_SECTION.test(plain))excluding=false;
  if(!excluding)kept.push(rawSpan);
 }
 return kept.join(" ");
}

// Splits text into locality units (sentence/clause/bullet granularity) so a
// negative or off-topic occurrence in one clause never suppresses an
// independent positive occurrence elsewhere in the same document — see
// Section 7's "context scope" requirement. HTML block boundaries
// (</p>,</li>,</tr>,<br>) are treated as hard breaks in addition to
// terminal punctuation, since list items and table rows frequently have no
// trailing period.
export function splitSentences(text:string):string[]{
 const withBreaks=text.replace(/<\/(?:p|li|tr|td|th|h[1-6]|div)\s*>/gi,"$&@@PIM_BLOCK_BREAK@@").replace(/<br\s*\/?>/gi,"@@PIM_BLOCK_BREAK@@");
 return withBreaks.split(/@@PIM_BLOCK_BREAK@@|(?<=[.;!?])\s+/).map(s=>s.trim()).filter(Boolean);
}

// NEGATION_CONTEXT / PROHIBITION_CONTEXT: "não use esponja de aço" (SKU
// TAJ/AS*BR1) states what must NOT be used on the product — the object of
// the prohibition is not the product's own material. Sentence-scoped so a
// genuine positive claim in a different sentence of the same description
// survives untouched.
const NEGATION_TRIGGER=/\b(?:n[aã]o\s+us[ae]|n[aã]o\s+utiliz[ae]|n[aã]o\s+aplic[ae]|evite|n[aã]o\s+recomendado|n[aã]o\s+compat[ií]vel|nunca\s+us[ae])\b/i;

// CHEMICAL_COMPOSITION_CONTEXT: "composto por silicatos de cálcio,
// alumínio e ferro" (SKU CIMENTUPI50) is Portland cement's chemical
// makeup, not a commercial material claim ("this product is made of
// aluminum"). Chemistry vocabulary is a reliable, generalizable signal —
// it is not specific to any one SKU or brand.
const CHEMICAL_COMPOSITION_TRIGGER=/\b(?:composto\s+por|f[oó]rmula\s+cont[ée]m|silicatos?|sulfatos?\s+de|carbon[aá]tico|pozol[aâ]nico|[oó]xido\s+de|hidr[oó]xido\s+de)\b/i;

// APPLICATION_TOOL_CONTEXT / INSTALLATION_TOOL_CONTEXT: "desempenadeira de
// aço inox" (SKUs 157053783, TX1925) and "martelo de borracha" (SKU
// 000000000006054227) name the tool used to apply/install the product, not
// the product's own material. Requires "<tool noun> de" so it never
// matches when the tool itself IS the product (a genuine "Martelo ...
// Material: Aço" listing is unaffected, because that phrasing never puts
// "de" directly after the tool noun in this construction).
const TOOL_CONTEXT_TRIGGER=/\b(?:desempenadeira|esp[aá]tula|colher\s+de\s+pedreiro|martelo|pincel|rolo\s+de\s+(?:l[ãa]|pintura)|trincha|talhadeira)\s+de\b/i;

// A3.5E-P2-J, Section 13: TERMINAL_COMPONENT_CONTEXT. A "Material:" label
// is only reliable proof of the PRODUCT's own principal material when its
// value describes the product itself -- "terminais de latão niquelado"
// names a small connective HARDWARE PART's material, not the labeled
// product's own body/composition. Confirmed real cases: SKUs
// 107376/107377/107378/107379/107380/107381/107382 (Fusível De Vidro, 7
// amperage variants of the same product line) all persisted material=Latão
// from "Material: Vidro transparente com terminais de latão niquelado" --
// the fuse's real material ("vidro"/glass) is not itself in the canonical
// option list, so the existing 80-char post-label window scan (see
// findExplicitMaterials in extractor.ts) fell through past the
// non-canonical first word and picked up the terminals' brass instead.
// "terminal(is) de <material>" is a narrow, high-confidence, generalizable
// signal: it never appears in any of this catalog's confirmed-genuine
// material claims ("Cabo de Aço", "Martelo de Borracha", "Bucha de Latão",
// "Parafuso Latão" -- measured across all 615 currently-persisted material
// rows, A3.5E-P2-J Section 13 corpus audit) because none of those products
// describe themselves via a "terminal" component. Dropping the whole
// sentence/list-item (not just masking the word) means no material
// candidate is emitted for this label occurrence at all -- fail-closed,
// matching the codebase's existing standard for insufficient evidence
// (see the nut-and-bolt/chain-weld cases above) -- rather than guessing a
// wrong principal material. A separate, narrower ambiguity (a squeegee's
// aluminum HANDLE outranking its own plastic body, SKU RODO/6AP*PR) uses
// the word "cabo" as a homonym (handle, not cable) with no safe
// generalizable syntactic signal found in this round's corpus audit -- left
// as NEEDS_REVIEW in the remediation classification rather than
// papering over it with an invented rule.
const TERMINAL_COMPONENT_TRIGGER=/\bterminais?\s+de\b/i;

// MECHANICAL_PROPERTY_CONTEXT: "resistência à compressão" (SKUs
// 101020313, 1009018-1600 — concrete/mortar) and "proteção contra impactos
// e compressão" (SKU 555-39 — a safety boot's steel toe cap) are both
// mechanical/impact-resistance properties, nothing to do with a
// compression-type pipe/hose fitting. Rather than enumerate every possible
// mechanical-property phrasing around "compressão" (open-ended,
// whack-a-mole), this is a POSITIVE allowlist instead: a "compressão"
// occurrence only counts as a connection type when a real connector/fitting
// noun appears in the same sentence (mirrors the positive-signal approach
// already used for material's "Material:"-style labels). Every genuine
// compression-fitting mention in this catalog names the fitting itself
// ("Terminal Compressão", "Engate de Compressão", "Conexão por
// Compressão") — a bare property claim never does.
const CONNECTOR_NOUN=/\b(?:conex[ãa]o|engate|terminal|encaixe|junta|acoplamento|conector|niple|luva|adaptador|redu[çc][ãa]o|registro)\b/i;
function stripUnanchoredCompression(text:string):string{
 return splitSentences(text).map(sentence=>CONNECTOR_NOUN.test(sentence)?sentence:sentence.replace(/compress[ãa]o/gi," ")).join(" ");
}

// "Sem rosca"/"sem solda"/"sem flange"/"sem compressão"/"sem engate" (SKU
// 56131023 "Luva de Emenda Sem Rosca Flexor" — a pressure-fit conduit
// coupling that repeatedly, explicitly advertises NOT having a thread)
// negates the specific connection word right next to it. This is distinct
// from NEGATION_TRIGGER above (which covers "não use/aplicar/evite" style
// prohibitions of an object) — here the negated word IS the candidate
// value itself, so it is masked rather than dropping the whole sentence
// (an independent, unnegated connection word elsewhere in the same
// sentence, if any, survives).
const NEGATED_CONNECTION_WORD=/\bsem\s+(?:rosc(?:a|agem|[aá]vel)|solda(?:gem|r|d[oa]|[aá]vel)?|compress[ãa]o|flange|engate)\b/gi;

// CONNECTION_DOMAIN_GATE for "soldável"/"solda": a first attempt reused
// `hasHydraulicContext` (the existing bitola-promotion domain check) as a
// blanket gate on every connection candidate, but that regressed a real
// existing product shape — "Adaptador Soldável 25X3/4"" / "Conexão
// soldável com diâmetro de 25mm x 3/4" em PVC" (tests/pimP4bReconciliation)
// has no HYDRAULIC_TERMS word at all (no joelho/luva/bucha/registro/etc —
// "adaptador"/"conexão"/"diâmetro" aren't in that list), yet is a
// genuine hydraulic connection. HYDRAULIC_TERMS is calibrated for the
// narrower, more conservative bitola-promotion decision and is not broad
// enough to gate `connection` in general without new false negatives.
// Instead, mask "soldável/soldado" specifically where it co-occurs with
// "corrente"/"elo" (chain-link vocabulary) — SKU 9740 "Corrente Soldável
// Zincada": elos soldados describes a WELDED-LINK construction method for
// a chain, not a hydraulic solder joint. This generalizes to any chain
// product using this vocabulary, not just this one SKU.
const CHAIN_WELD_CONTEXT=/(?:\b(?:corrente|elos?)\b[^.;]{0,60}\bsold(?:[aá]vel|ad[oa]s?|agem)\b)|(?:\bsold(?:[aá]vel|ad[oa]s?|agem)\b[^.;]{0,60}\b(?:corrente|elos?)\b)/gi;

// A3.5E-P2-G-R1, Section 9: `conexao`'s seeded vocabulary
// (Soldável/Roscável/Compressão/Engate Rápido/Flange — see the A3.5C
// migration and tests/pimA35cCanonicalAttributes.test.mjs, "connection
// vocabulary is the connection type, never a bitola/size value") was
// designed to classify how PIPES/HOSES/CONDUITS/WIRES join to each
// other — not "this product happens to be held together by a threaded
// bolt." There is no formally documented answer either way for a
// generic threaded fastener that is part of a non-connector product's own
// hardware (SKU 61464 "Grampo Galvanizado DIN 741": "Roscas de Precisão:
// Possui porcas e roscas ajustadas para garantir firmeza na fixação" — a
// wire-rope clamp's own nut-and-bolt assembly, not a pipe/hose/conduit
// joining interface). Per Section 9's explicit instruction, insufficient
// documented evidence means FAIL CLOSED — exclude, don't infer. The
// generalizable signal is "rosca/roscável" co-occurring with "porca(s)"
// (nut) in the same sentence: a nut-and-bolt fastening callout, common to
// clamps/brackets/wire-rope grips, never how a pipe fitting, valve, hose
// bib, conduit connector or lamp base describes its own thread (none of
// the confirmed-genuine roscável cases in this catalog — Luva Roscável,
// Tê Roscável, Bucha Zamak, Regulador de Gás, prensa-cabo BSP, lâmpada
// base E27 — ever pair "rosca" with "porca").
const NUT_MENTION=/\bporcas?\b/i;
const THREAD_WORD=/rosc(?:a|as|[aá]vel|[aá]veis)/gi;
// Sentence-scoped (not a windowed regex pair): a real case ("Roscas de
// Precisão: Possui porcas e roscas ajustadas...") mentions the thread word
// TWICE around a single "porcas" — a fixed-width lookaround regex only
// masks the occurrence closest to "porcas" and lets the second one
// survive. Masking every thread-word occurrence in any sentence that
// mentions "porca(s)" anywhere closes that gap.
function stripNutAndBoltFasteningThread(text:string):string{
 return splitSentences(text).map((sentence)=>NUT_MENTION.test(sentence)?sentence.replace(THREAD_WORD," "):sentence).join(" ");
}

function stripSentencesMatching(text:string,trigger:RegExp):string{
 return splitSentences(text).filter(sentence=>!trigger.test(sentence)).join(" ");
}

// ACCESSORY_CONTEXT for measurements: "Compatível com rolos de até 50 mm de
// largura e 50 metros de comprimento" (SKU 3885, a tape APPLICATOR/
// dispenser tool) states the compatible tape ROLL's own dimensions, not
// the tool's. Unlike the material/connection accessory cases, this is
// prose, not a table, and the object whose measurement follows
// "compatível com" is the accessory — so truncating each sentence at that
// point (keeping only the text before it) is the right locality: a
// connection word appearing BEFORE "compatível com" in the same sentence
// (e.g. "Bico de rosca compatível com engates rápidos", genuinely the
// product's own thread) is preserved, only the trailing compatible-object
// clause is dropped.
// SKU 3885's contamination isn't only in the "Compatível com..." sentence —
// its own <h2> heading already says "para Rolos até 50 mm e 50 m", using
// "rolo(s) até" as a second, common phrasing for a compatible consumable's
// maximum capacity (a roll of tape/wire/cable, sold and measured
// separately from the dispenser/tool itself). Scoped to "rolo(s) [de] até"
// specifically — NOT a bare "até" trigger — so an unrelated, genuine
// product spec like "resistente até 300°C" or "suporta até 50kg" is
// untouched.
// "até" ends in an accented "é", which JS's ASCII-only `\b` never closes a
// word boundary after (same root cause as the "tê" lookahead fix in
// extractor.ts's HYDRAULIC_TERMS) — `at[ée]\b` would silently never match
// "até" followed by a space, so the lookahead form is required here too.
//
// A3.5E-P2-G-R1, Section 8 audit finding: SKU V0210628 "Massa de Calafetar
// Madeira F-12 400G" — a 400g putty tube — matched comprimento=100m from
// "Dados Técnicos > Consumo: 1 kg calafeta ~100 m de junta de 2 × 2 mm", a
// COVERAGE YIELD (how much joint length 1kg of product covers), not the
// tube's own length. "Dados Técnicos"/"Características" is a legitimate
// PRODUCT_IDENTITY heading in general (Section 4/6), but a "Consumo:"/
// "Rendimento:" labeled clause inside it is still describing an
// application/coverage RATE, not the product's own declared dimension —
// same family as "compatível com" (a label that introduces a DIFFERENT
// kind of fact than the product's own spec), so it gets the same
// truncate-the-sentence-at-the-label treatment.
// The label and its colon are frequently split by inline markup in this
// catalog — "<strong>Consumo</strong>: 1 kg calafeta ~100 m..." (SKU
// V0210628) — so the gap between the label word and ":" must tolerate
// HTML tags, not just whitespace.
//
// A3.5E-P2-G-V2 audit finding: SKU 1009023 "Protec Primer... 18kg" — under
// a genuine "DADOS TÉCNICOS" identity heading — has "Estocagem: ...
// empilhamento máximo 1,5 m de altura na embalagem original", a WAREHOUSE
// STACKING-HEIGHT instruction, not the primer bucket's own length. Same
// family as "Consumo:"/"Rendimento:" (a labeled clause that introduces a
// logistics/handling fact, not the product's own declared dimension).
//
// A3.5E-P2-M, Classe A (COVERAGE_GAP_LABEL_VARIANT): the original grammar
// required the label word to be followed IMMEDIATELY (modulo HTML tags) by
// ":" — real catalog copy virtually never writes the bare label alone.
// SKUs V0210636 ("Consumo estimado:") and V0210681 ("Consumo de
// referência:") both insert one or two qualifying words between the label
// and the colon. A full-catalog scan of every "consumo/rendimento/
// estocagem/cobertura" occurrence followed eventually by ":" (A3.5E-P2-M
// corpus audit) found the real vocabulary is an open set of short
// adjective/prepositional qualifiers — "estimado", "de referência",
// "médio", "aproximado", "mínimo de X" — never more than a handful of
// words, and "cobertura"/"cobertura aproximada" is a real, previously
// unhandled member of the same label family (a paint/coating yield rate,
// same kind of fact as consumo/rendimento). Rather than enumerate each
// literal phrase (an open-ended, whack-a-mole list), the label is allowed
// up to 3 intervening lowercase word tokens before the colon — a genuine
// grammatical generalization of "a short qualifier phrase", not a per-
// phrase blacklist. Sentence-scoped truncation (already how
// truncateAtCompatibilityClause works) keeps this occurrence-local: "Consumo
// estimado: X; comprimento: 2m." splits into two sentences at the
// semicolon, so the unrelated "comprimento: 2m" clause is never touched.
const COMPATIBILITY_CLAUSE=/compat[íi]vel\s+com\b|rolos?\s+(?:de\s+)?at[ée](?=[^a-zà-ÿ]|$)|\b(?:consumo|rendimento|estocagem|cobertura)\b(?:\s+[a-zà-ÿ]+){0,3}\s*(?:<[^>]+>)*\s*:/i;
export function truncateAtCompatibilityClause(text:string):string{
 return splitSentences(text).map(sentence=>{
  const match=COMPATIBILITY_CLAUSE.exec(sentence);
  return match?sentence.slice(0,match.index):sentence;
 }).join(" ");
}

// A3.5E-P2-G-R1, Section 4/5: the measurement-extraction path (comprimento,
// volume, and the bitola/bitola_mm/diameter/voltage/etc. codes that share
// the same `extractMeasurements` call in extractor.ts) needs the SAME
// section-scoping and compatibility-clause protection as material and
// connection — that gap is exactly how SKU 101020313's application-height
// "até 1 m" reached comprimento. It deliberately does NOT get the
// material/connection-specific triggers (TOOL_CONTEXT_TRIGGER,
// CHEMICAL_COMPOSITION_TRIGGER, NEGATION_TRIGGER, chain-weld, negated-
// connection-word, compression allowlist): those are lexically tied to
// material/connection vocabulary, and applying TOOL_CONTEXT_TRIGGER in
// particular to TITLE text (measurements read both title and description)
// would wrongly blank out a product whose own title names a tool it PART
// of the product's identity, e.g. a "Desempenadeira ... 30cm" trowel
// naming its own length. Titles essentially never contain document
// headings, so section-scoping is a safe no-op there.
// A3.5E-P2-J, Section 7/8: PRESSURE_CONTEXT. "75 m.c.a." (metros de coluna
// d'água) is a PRESSURE rating -- how much hydrostatic head the fitting
// withstands -- not the product's own physical length, even though the
// unit letter "m" is identical to the length unit. Confirmed real cases
// (23+ Fortlev PVC fittings: curvas/caps/plugs/adaptadores, all sharing the
// templated spec line "...suportam até 7,5Kgf/cm² ou 75 m.c.a...."; also a
// pressurizing pump's "20 m.c.a." pumping head, a urinal valve's "40 m.c.a."
// line-pressure rating, and a waterproofing product's "80 m.c.a." resistance
// claim) show this is a genuine, catalog-wide class, not one SKU's typo.
// Masking is OCCURRENCE-scoped (only the "<number> m.c.a." span itself, via
// a global regex replace), never sentence- or product-wide -- a real
// "Tubo 6 m, pressão máxima 75 m.c.a." description keeps comprimento=6m
// because the "75 m.c.a." span is masked in place while "6 m" is untouched
// elsewhere in the same text.
// Other pressure units (kgf/cm², bar, psi, Pa/kPa/MPa) are masked too:
// audited for real occurrences in this catalog's comprimento/volume
// candidates (Section 8's mandatory corpus check) -- see the A3.5E-P2-J
// report for the exact count found. None of these unit letters currently
// collide with the length/volume regex the way "m"/"L" do, but masking them
// is free (they never match a genuine measurement anyway) and closes the
// same class of risk if the measurement pattern is ever extended.
const MCA_UNIT=/\d+(?:[.,]\d+)?\s*m\.?\s*c\.?\s*a\.?\b/gi;
const OTHER_PRESSURE_UNIT=/\d+(?:[.,]\d+)?\s*(?:kgf\s*\/\s*cm[²2]|bars?|psi|k?Pa)\b/gi;
export function maskPressureContext(text:string):string{
 return text.replace(MCA_UNIT," ").replace(OTHER_PRESSURE_UNIT," ");
}

// A3.5E-P2-R, Section 9/10: PRESSURE_MCA has two spelled-out (non-
// abbreviated) variants that the "m.c.a."/"mca" masks above never covered,
// both confirmed real in this catalog's own text (A3.5E-P2-R corpus audit
// of every "altura manométrica"/"elevação"/"coluna d'água" occurrence):
//
// 1) PRESSURE_HEAD_LABEL: "Altura manométrica máxima: 65 metros" (SKU
//    60560, a submersible pump) and 15 sibling Altri/Anauger pump listings
//    ("altura manométrica [total] [máxima] [de até]: N metros",
//    "[capacidade de] elevação [máxima] de [até] N metros") state the
//    pump's HEAD/LIFT rating — how high it can push water — never the
//    product's own physical length, even though every one of these listings
//    uses the un-abbreviated word "metros". A3.5E-P2-R broader corpus check
//    (verifying siblings of the two originally-reported SKUs, not just
//    those two) found a third pump-rating label of the same kind:
//    "Submersão máxima: até 80 m" (SKU 101089) / "submersão máxima: 1
//    metro" (SKU 60590) — how deep underwater the pump may operate, again
//    never the product's own length. This surfaced only once
//    normalizeMeterWordVariants started recognizing "metros" as a unit
//    word; masking is scoped to the label-to-number span (bounded to 40
//    chars, matching this codebase's existing CHAIN_WELD_CONTEXT-style
//    windowed lookahead) so an unrelated, differently-labelled length claim
//    elsewhere in the same product's text is untouched.
// 2) COLUNA_DAGUA_UNIT: "80 metros de coluna d'água" (SKU 5859541) and two
//    more real occurrences ("150 metros coluna d'água", "100 metros de
//    coluna d'água") spell out "metros de coluna d'água" — the full,
//    unabbreviated Portuguese term "m.c.a." itself abbreviates — with no
//    "m.c.a."/"mca" abbreviation anywhere in the sentence at all. Both
//    masks run AFTER normalizeMeterWordVariants (see
//    excludeMeasurementNonAttributiveContext below), so by this point every
//    real occurrence's "metros" has already normalized to "m".
const PRESSURE_HEAD_LABEL=/\b(?:altura\s+manom[ée]trica(?:\s+total)?(?:\s+m[áa]xima)?|(?:capacidade\s+de\s+)?eleva[çc][ãa]o(?:\s+m[áa]xima)?|(?:capacidade\s+de\s+)?elevar\s+[áa]gua|submers[ãa]o(?:\s+m[áa]xima)?)\b[^.;]{0,40}?\d+(?:[.,]\d+)?\s*m\b/gi;
// A3.5E-P2-R: a bullet-style restatement of the SAME pump-pressure rating,
// confirmed on 2 real sibling listings (Altri 3AT2-21 variants) that
// separately also state "Altura manométrica máxima: até 145 m" elsewhere
// in the same description — "Pressão Extremamente Alta – Até 145m" /
// "Pressão Muito Elevada – Até 145m". Distinct shape (dash-separated
// marketing bullet, not a colon-labelled spec line) so it gets its own
// regex rather than overloading PRESSURE_HEAD_LABEL's shape.
const PRESSURE_BULLET_RESTATEMENT=/press[ãa]o[^.;]{0,40}?[-–—][^.;]{0,15}?at[ée]\s*\d+(?:[.,]\d+)?\s*m\b/gi;
const COLUNA_DAGUA_UNIT=/\d+(?:[.,]\d+)?\s*m\s*(?:de\s+)?coluna\s+(?:d\s*['´′ʼ’́]?|de)\s*[áa]gua/gi;
export function maskPressureLongFormContext(text:string):string{
 return text.replace(PRESSURE_HEAD_LABEL," ").replace(PRESSURE_BULLET_RESTATEMENT," ").replace(COLUNA_DAGUA_UNIT," ");
}

// A3.5E-P2-J, Section 9: FLOW_RATE_CONTEXT. "Vazão Nominal: 1.200 L/h" is a
// FLOW RATE (volume per unit time), not the product's own static container
// volume -- a completely different physical quantity that happens to share
// the "L" unit letter. Confirmed real case: SKU 5010002 "Filtro para Caixa
// d'Água" persisted volume=1,2L, sourced from this exact "1.200 L/h" flow
// spec (compounded by a thousands-separator misread -- see the ruleVersion
// note in the remediation artifact). Occurrence-scoped: "Reservatório 20L,
// vazão 1.200 L/h" keeps volume=20L because only the "1.200 L/h" span is
// masked, not the whole sentence/product.
const FLOW_RATE_UNIT=/\d+(?:[.,]\d+)?\s*(?:mL|ml|L)\s*\/\s*(?:h|hs?|hora|horas|min|mins?|minuto|minutos)\b/gi;
const VOLUMETRIC_FLOW_UNIT=/\d+(?:[.,]\d+)?\s*m[³3]\s*\/\s*(?:h|hs?|hora|horas|min|mins?|minuto|minutos)\b/gi;
export function maskFlowRateContext(text:string):string{
 return text.replace(FLOW_RATE_UNIT," ").replace(VOLUMETRIC_FLOW_UNIT," ");
}

// A3.5E-P2-J, Section 10: ELECTRICAL_SI_PREFIX_CONTEXT. "Impedância de
// entrada: 1 M Ohms" -- the SI mega-prefix "M" immediately before an
// electrical/frequency unit word is never the length unit "m" (meter), even
// though `measurementPattern` (normalization.ts) matches unit letters
// case-insensitively. Confirmed real case: SKUs 3331/5570 (Lotus digital
// multimeters) persisted comprimento=1m, sourced from "impedância 1 M Ohms
// em todas as escalas" -- a spec sheet value, not a cable/product length.
// Root cause is structural, not this one phrase: `measurementPattern`'s
// bare "m" alternative requires only that no letter immediately follows the
// match (so "10 MW" with no space is already correctly rejected -- "W" is a
// letter right after "M" -- but "1 M Ohms" has a SPACE before "Ohms", which
// is not a letter, so the existing guard does not catch it). Masking the
// whole "<number> M <electrical-unit>" span before the measurement regex
// ever runs closes this independently of that structural quirk.
// Occurrence-scoped: "Cabo de teste: 1 m, impedância 1 M Ohms" keeps
// comprimento=1m because only the "1 M Ohms" span is masked.
const ELECTRICAL_PREFIX_UNIT=/\d+(?:[.,]\d+)?\s*[MmKk]\s*(?:Ω|ohms?|hz|va)\b/gi;
export function maskElectricalPrefixContext(text:string):string{
 return text.replace(ELECTRICAL_PREFIX_UNIT," ");
}

// A3.5E-P2-M, Section 7: MODEL_CODE_FRAGMENT_MISREAD_AS_MEASUREMENT (part
// 1/2). SKU 00000000000015 "Reparo Registro Pressão 1416 M.V.S Master R20"
// persisted comprimento=1416m from "1416 M" — the bare unit-letter "M" is
// immediately followed by ".V.S", a dotted multi-letter ABBREVIATION/MODEL
// CODE continuation (never a real unit suffix), which the existing
// trailing-letter lookahead in normalization.ts's measurementPattern does
// not catch because "." is not a letter. Full-catalog audit (A3.5E-P2-M
// corpus scan) of every "<number> <letter>.<letter>..." occurrence found
// this is a genuinely narrow, generalizable shape: a bare unit letter
// followed by two or more ".letter" groups is a dotted abbreviation/model
// code in every real occurrence except the catalog's existing "m.c.a."
// (metros de coluna d'água) family, which is already masked independently
// by maskPressureContext above — applying this mask redundantly to those
// is harmless (masking an already-masked span is a no-op). Requiring at
// least TWO dot-letter groups (not one) deliberately excludes genuine
// single-group technical shorthand like "12 N.m" (newton-metre torque),
// which never collides with this catalog's length/volume unit vocabulary
// anyway ("N" is not a recognized unit letter) but is kept out of scope on
// principle rather than relying on that coincidence.
const MODEL_CODE_DOTTED_ABBREVIATION=/\d+(?:[.,]\d+)?\s*[A-Za-z](?:\.[A-Za-z]){2,}\.?\b/g;
export function maskModelCodeDottedAbbreviation(text:string):string{
 return text.replace(MODEL_CODE_DOTTED_ABBREVIATION," ");
}

// A3.5E-P2-W, Section 12/13 pending-22 individual audit: REFERENCE_CODE_
// SLASH_M_MISREAD_AS_LENGTH. SKUs "C/2019Mastra" (Tubo PEX Sr. 5 20x16,2mm)
// and "C/1618M" (Tubo PEX Sr. 5 16x12,4mm) -- both PEX tubes sold "Preço
// Por Metro" with no fixed length of their own -- persisted comprimento
// candidates of 2019m/1618m, sourced entirely from the product's own
// internal catalog reference code ("Referência:C/2019M" /
// "Referência:C/1618M"), never from an actual length statement anywhere in
// either product's text. The reference-code shape (an optional short letter
// prefix, a literal "/", one or more digits, then a bare "M") immediately
// following the label "Referência:"/"Ref.:" is structurally identical to a
// metre measurement, but a WooCommerce internal SKU/reference string is
// never a physical dimension of the product. Full-catalog scan confirmed
// this is a narrow, generalizable shape: exactly 2 of 3080 products carry
// it, both false positives, zero legitimate collisions found.
const REFERENCE_CODE_SLASH_M=/refer[êe]ncia\s*:?\s*[A-Za-z]*\/\d+M\b/gi;
export function maskReferenceCodeMisreadAsMeasurement(text:string):string{
 return text.replace(REFERENCE_CODE_SLASH_M," ");
}

// A3.5E-P2-M, Section 7: MODEL_CODE_FRAGMENT_MISREAD_AS_MEASUREMENT (part
// 2/2). SKU 4446Opl "Plafon 1l Sq Porc. 100w Preto - Opl" persisted
// volume=1L from the title's "1l" — a model-code fragment (this catalog's
// WooCommerce titles frequently embed an internal spec-code string with no
// separators from the commercial name) that happens to have the same
// digit+letter shape as a genuine litre measurement, and is not caught by
// any lexical-boundary rule because it IS followed by a plain space (no
// letter, no digit) — indistinguishable from "Galão 1L" by shape alone.
// The generalizable, non-blacklist signal is cross-referential, not
// positional: this exact product's OWN description independently states
// "Suporta 1 lâmpada de até 100w" — the same number the title's "1l" token
// carries also appears, elsewhere in the same product's text, immediately
// before the word "lâmpada(s)". A number that is independently confirmed
// by the product's own text to refer to a LAMP COUNT is not, at the same
// time, also that product's litre volume — masked only where the specific
// number matches (occurrence-scoped: a product mentioning "1 lâmpada" does
// not lose an unrelated, differently-numbered "5L" elsewhere).
const LAMP_COUNT_MENTION=/(\d+)\s*l[âa]mpadas?\b/gi;
export function findLampCountNumbers(combinedText:string):Set<string>{
 const found=new Set<string>();
 for(const match of combinedText.matchAll(LAMP_COUNT_MENTION))found.add(match[1]);
 return found;
}
export function maskLampCountMisreadAsVolume(text:string,lampCountNumbers:Set<string>):string{
 if(lampCountNumbers.size===0)return text;
 return text.replace(/\b(\d+)\s*[lL]\b(?!\p{L})/gu,(whole,digits)=>lampCountNumbers.has(digits)?" ":whole);
}

// A3.5E-P2-M, Achado C / Section 8: DIMENSION_ROLE_MISCLASSIFICATION. The
// canonical attribute model has exactly one linear-dimension attribute
// ("comprimento"/length) — there is no "largura"/"altura"/"espessura"/
// "profundidade" canonical attribute at all. Per the task's explicit rule,
// the ABSENCE of a canonical attribute for those roles never authorizes
// silently reinterpreting them as comprimento; a bare-metre value must be
// dropped, not relabeled. Full-catalog audit (A3.5E-P2-M corpus scan)
// confirmed this is a real, live defect class, not theoretical: SKU 3698
// "Alicate Cortador Cabo De Aço 42 Plus 3/1 (Altura 1,05m)" persists
// comprimento=1,05m sourced directly from its own title's "(Altura
// 1,05m)" parenthetical, and SKU 38796 (see the compound-separator guard
// in normalization.ts) is a second, independently-caused instance of the
// same "comprimento in the wrong role" outcome. Millimetre/centimetre
// role-labelled values (e.g. "Largura: 42mm") are already unaffected —
// they classify as diameter/bitola, never length, because that path keys
// off the "mm"/"cm" unit suffix — so this mask is scoped to the bare-metre
// case, the only shape that actually reaches the length bucket. Both the
// labelled form ("Largura: 1m", "(Altura 1,05m)") and the prose form ("1m
// de largura") are covered; "metro"/"metros" spelled out in full are
// normalized to "m" first (normalizeMeterWordVariants) so one pair of
// regexes covers both spellings without duplicating the role vocabulary.
// "comprimento" itself is deliberately absent from NON_LENGTH_ROLE so an
// explicit "Comprimento: 10m" is never masked by this rule.
const NON_LENGTH_ROLE="largura|altura|espessura|profundidade|di[âa]metro";
const METER_WORD=/(\d(?:[.,]\d+)?)\s*metros?\b/gi;
export function normalizeMeterWordVariants(text:string):string{
 return text.replace(METER_WORD,"$1m");
}
const LABELED_NON_LENGTH_DIMENSION=new RegExp(`\\b(?:${NON_LENGTH_ROLE})\\b(?:\\s*<[^>]+>)*\\s*:?\\s*\\(?\\s*\\d+(?:[.,]\\d+)?\\s*m\\b(?!m|[²³0-9])`,"gi");
const PROSE_NON_LENGTH_DIMENSION=new RegExp(`\\d+(?:[.,]\\d+)?\\s*m\\s+de\\s+(?:${NON_LENGTH_ROLE})\\b`,"gi");
export function maskNonLengthDimensionRole(text:string):string{
 return text.replace(LABELED_NON_LENGTH_DIMENSION," ").replace(PROSE_NON_LENGTH_DIMENSION," ");
}

// A3.5E-P2-M, Section 7 (generalization): BRAND_NAME_MISREAD_AS_MEASUREMENT.
// SKUs 14280 ("Fita Isolante Imperial Slim 18mmx05m - 3M") and 72303 ("Fita
// Crepe 3M 101 LA 24X50") persist comprimento=3m sourced from the BRAND
// NAME "3M" (the manufacturer) — a company name that happens to have the
// exact <number><unit-letter> shape the length regex looks for. This was
// invisible before normalizeMeterWordVariants existed: without full-word
// "metro(s)" recognition, the product's own genuine, explicitly-labelled
// length ("50 metros de comprimento", "1,5 metro de comprimento") was never
// extracted at all, so "3M" stood alone as the only length candidate and
// silently won — adding real "metro" recognition is what surfaces the
// pre-existing conflict, not something it introduces. A full-catalog scan
// of `brands.name` for any brand shaped like `<number><1-4 letters>` found
// exactly one match ("3M", 15 products) — the fix keys off the product's
// OWN structured brand field, not a hardcoded "3M" string, so it
// generalizes automatically to any future brand with the same collision
// shape without a per-brand list.
const MEASUREMENT_SHAPED_BRAND=/^\d+(?:[.,]\d+)?\s*[A-Za-zÀ-ÿ]{1,4}$/;
export function maskBrandNameMisreadAsMeasurement(text:string,brand:string|null):string{
 const trimmed=brand?.trim();
 if(!trimmed||!MEASUREMENT_SHAPED_BRAND.test(trimmed))return text;
 const escaped=trimmed.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 return text.replace(new RegExp(`\\b${escaped}\\b`,"gi")," ");
}

// A3.5E-P2-T, Section 27 final blind-audit finding: SKU 1775055 "Alicate
// Desencapador De Fios, 210 mm, 1,5 - 6,5 m, 1 Pc Sparta" -- the title's
// "1,5 - 6,5 m" is the tool's wire-stripping GAUGE CAPACITY range (the
// description confirms: "desencapa fios e cabos de 1.5mm a 6.5mm"), not
// the tool's own physical length, which is separately and correctly
// stated as "Comprimento: 260mm" in the description. A stripping/cutting
// hand tool's own length is always a single fixed dimension, never a
// range -- so any bare "N - M m" range (single "m", never "mm") that
// co-occurs with wire-stripping/decapagem vocabulary in the SAME source
// text is, by the physical nature of the product, a gauge/capacity spec,
// not a length. This is decidable entirely from the product's own text
// (unlike the Esgoto SN cross-product contradiction), so it is fixed here
// rather than deferred to an audit-level exclusion. Scope-verified via a
// full-catalog scan before this fix: exactly 1 of 3080 products carries
// this pattern, 0 persisted in staging.
const WIRE_STRIPPING_CONTEXT=/desencap|decapa/i;
const WIRE_GAUGE_CAPACITY_RANGE=/\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*m\b(?!m)/gi;
export function maskWireGaugeCapacityRange(text:string):string{
 if(!WIRE_STRIPPING_CONTEXT.test(text))return text;
 return text.replace(WIRE_GAUGE_CAPACITY_RANGE," ");
}

export function excludeMeasurementNonAttributiveContext(html:string):string{
 const withoutPlaceholders=maskInstructionalPlaceholderContent(html);
 const withoutTables=stripAccessoryTables(withoutPlaceholders);
 const withoutApplicationSections=stripApplicationInstructionSections(withoutTables);
 const withoutCompatibilityClauses=truncateAtCompatibilityClause(withoutApplicationSections);
 const withNormalizedMeterWords=normalizeMeterWordVariants(withoutCompatibilityClauses);
 const withoutNonLengthDimensionRole=maskNonLengthDimensionRole(withNormalizedMeterWords);
 const withoutModelCodeAbbreviation=maskModelCodeDottedAbbreviation(withoutNonLengthDimensionRole);
 const withoutReferenceCode=maskReferenceCodeMisreadAsMeasurement(withoutModelCodeAbbreviation);
 const withoutPressure=maskPressureContext(withoutReferenceCode);
 const withoutPressureLongForm=maskPressureLongFormContext(withoutPressure);
 const withoutFlowRate=maskFlowRateContext(withoutPressureLongForm);
 const withoutElectricalPrefix=maskElectricalPrefixContext(withoutFlowRate);
 return maskWireGaugeCapacityRange(withoutElectricalPrefix);
}

// Full description preprocessing pipeline shared by material and
// connection extraction. Order matters: strip accessory tables and
// application-instruction sections first (both are whole-region removals,
// so running them before the finer sentence-level rules avoids those rules
// scoring text that will be discarded anyway), then drop negated/prohibited
// and chemical-composition sentences, then mask the chain-weld
// co-occurrence, the negated connection word, the nut-and-bolt fastening
// thread, and finally the unanchored (non-connector-qualified)
// "compressão" mentions in what remains.
// A3.5E-P2-T, Section 12: DUAL_COMPATIBILITY. SKUs A39.01/A18.01 ("Caixa
// de Passagem Para Eletroduto PVC") restate, in three different phrasings
// across the same description (a "Principais Diferenciais" bullet, the SEO
// meta description, and a closing keyword list), that the box accepts
// EITHER "eletroduto soldável" OR "eletroduto roscável" -- a passage/
// junction box has no connection type of its own at all, it merely accepts
// conduit of either kind. The "compatível com X e Y" phrasing is already
// truncated by truncateAtCompatibilityClause above, but the bare keyword-
// list restatement ("caixa para eletroduto soldável e roscável") carries no
// "compatível com" trigger and survives. A full-catalog scan for any two
// of the 5 canonical connection words directly joined by "e"/"ou" found
// exactly these 2 products (6 occurrences) -- no case anywhere in this
// catalog uses this bare-list shape for a product's OWN, single connection
// type (every genuine dual-role product found in prior rounds, e.g. a
// reduction bushing soldável on one end and roscável on the other, states
// each side with its own role label -- "lado soldável"/"lado roscável" --
// which the existing SEMANTIC_ROLE_SEPARATION logic in
// source-conflict-policy.ts already handles correctly and this mask never
// touches, since it only fires on a BARE, unlabelled adjacency). Masking
// removes BOTH words from the pair rather than guessing which one (if
// either) is the "real" one -- consistent with this codebase's fail-closed
// standard for insufficient evidence.
const DUAL_CONNECTION_ADJACENCY=/\b(?:soldável|roscável|compress[ãa]o|engate\s+r[áa]pido|flange)\b(?:\s+(?:eletroduto|tubo|cano)\s+|\s+)(?:e|ou)\s+(?:eletroduto\s+|tubo\s+|cano\s+)?\b(?:soldável|roscável|compress[ãa]o|engate\s+r[áa]pido|flange)\b/gi;
export function maskDualConnectionAdjacency(text:string):string{
 return text.replace(DUAL_CONNECTION_ADJACENCY," ");
}

export function excludeNonAttributiveContext(html:string):string{
 const withoutPlaceholders=maskInstructionalPlaceholderContent(html);
 const withoutTables=stripAccessoryTables(withoutPlaceholders);
 const withoutApplicationSections=stripApplicationInstructionSections(withoutTables);
 const withoutCompatibilityClauses=truncateAtCompatibilityClause(withoutApplicationSections);
 const withoutNegation=stripSentencesMatching(withoutCompatibilityClauses,NEGATION_TRIGGER);
 const withoutChemistry=stripSentencesMatching(withoutNegation,CHEMICAL_COMPOSITION_TRIGGER);
 const withoutToolContext=stripSentencesMatching(withoutChemistry,TOOL_CONTEXT_TRIGGER);
 const withoutTerminalComponent=stripSentencesMatching(withoutToolContext,TERMINAL_COMPONENT_TRIGGER);
 const withoutChainWeld=withoutTerminalComponent.replace(CHAIN_WELD_CONTEXT," ");
 const withoutNegatedConnectionWord=withoutChainWeld.replace(NEGATED_CONNECTION_WORD," ");
 const withoutNutAndBoltThread=stripNutAndBoltFasteningThread(withoutNegatedConnectionWord);
 const withoutUnanchoredCompression=stripUnanchoredCompression(withoutNutAndBoltThread);
 return maskDualConnectionAdjacency(withoutUnanchoredCompression);
}

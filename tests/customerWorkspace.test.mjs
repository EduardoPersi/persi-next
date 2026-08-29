import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");

test("Customer Workspace protege mutações e não recebe customerId",()=>{
  const route=read("app/api/account/workspace/[...segments]/route.ts");
  const controller=read("wordpress-plugin/persi-headless-account/src/Api/CustomerWorkspaceController.php");
  assert.match(route,/getServerAccountToken/);
  assert.match(route,/validateMutationSource/);
  assert.match(controller,/BearerAuthorization|authorization/);
  assert.equal(controller.includes("customerId"),false);
});

test("todas as páginas privadas usam noindex e Customer Workspace",()=>{
  for(const page of ["enderecos","perfil","lista-espera","produtos-vistos","contas-conectadas","notificacoes","listas"]){
    const source=read(`app/(institutional)/minha-conta/${page}/page.tsx`);
    assert.match(source,/index:\s*false,\s*follow:\s*false/);
    assert.match(source,/CustomerWorkspacePage/);
  }
});

test("perfil, endereços e lista de espera possuem operações reais",()=>{
  assert.match(read("components/Account/CustomerProfileForm.tsx"),/method: "PUT"/);
  const addresses=read("components/Account/CustomerAddresses.tsx");
  assert.match(addresses,/method: "PUT"/);
  assert.match(addresses,/method: "DELETE"/);
  assert.match(addresses,/Bairro/);
  assert.match(read("components/Account/StockNotificationList.tsx"),/method:"DELETE"/);
});

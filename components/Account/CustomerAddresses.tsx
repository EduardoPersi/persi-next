"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/UI/Button";
import { usePostcodeAddressLookup } from "@/hooks/usePostcodeAddressLookup";
import { formatBrazilianPhone } from "@/lib/formatting/personalData";
import { formatPostcode, normalizePostcode } from "@/lib/commerce/shippingCalculator";
import type { CustomerWorkspaceAddress } from "@/lib/customer-workspace/types";

const keys = [
  "firstName", "lastName", "company", "address1", "neighborhood",
  "address2", "city", "state", "postcode", "country", "phone",
] as const;
type AddressKey = (typeof keys)[number];

const REQUIRED_KEYS: readonly AddressKey[] = ["address1", "neighborhood", "city", "postcode"];

const labels: Record<AddressKey, string> = {
  firstName: "Nome",
  lastName: "Sobrenome",
  company: "Empresa",
  address1: "Endereço",
  neighborhood: "Bairro",
  address2: "Complemento",
  city: "Cidade",
  state: "Estado",
  postcode: "CEP",
  country: "País",
  phone: "Telefone",
};

function formatAddresses(addresses: CustomerWorkspaceAddress[]) {
  return addresses.map((address) => ({
    ...address,
    phone: formatBrazilianPhone(address.phone),
  }));
}

// A loja usa um único endereço (cobrança = entrega, ver
// lib/commerce/checkoutAccountPrefill.ts) — a conta só edita o de
// "billing"; o backend mantém "shipping" espelhado automaticamente.
export function CustomerAddresses({
  initialAddresses,
}: {
  initialAddresses: CustomerWorkspaceAddress[];
}) {
  const [addresses, setAddresses] = useState(() => formatAddresses(initialAddresses));
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [isLookingUpAddress, setIsLookingUpAddress] = useState(false);
  const lookupPostcodeAddress = usePostcodeAddressLookup();
  const address = addresses.find((item) => item.type === "billing");
  const current = isEditing ? address : undefined;

  function updateField(key: AddressKey, value: string) {
    const nextValue = key === "phone" ? formatBrazilianPhone(value) : value;
    setAddresses((values) =>
      values.map((item) =>
        item.type === "billing" ? { ...item, [key]: nextValue } : item,
      ),
    );
  }

  function handlePostalCodeChange(value: string) {
    const formatted = formatPostcode(value);
    updateField("postcode", formatted);
    if (normalizePostcode(formatted).length !== 8) return;

    setIsLookingUpAddress(true);
    void lookupPostcodeAddress(formatted)
      .then((found) => {
        if (!found?.address1 || !found.city || !found.state) return;
        updateField("address1", found.address1);
        if (found.address2) updateField("neighborhood", found.address2);
        updateField("city", found.city);
        updateField("state", found.state);
      })
      .finally(() => setIsLookingUpAddress(false));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setMessage("");
    const payload = Object.fromEntries(keys.map((key) => [key, current[key]]));
    const response = await fetch("/api/account/workspace/addresses/billing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (response.ok) {
      setAddresses(formatAddresses(body));
      setIsEditing(false);
      setMessage("Endereço salvo.");
    } else {
      setMessage(body.message || "Não foi possível salvar.");
    }
  }

  async function remove() {
    if (!window.confirm("Remover este endereço?")) return;
    const response = await fetch("/api/account/workspace/addresses/billing", {
      method: "DELETE",
    });
    if (response.ok) {
      setAddresses(formatAddresses(await response.json()));
      setMessage("Endereço removido.");
    }
  }

  if (!address) return null;

  return (
    <div>
      {message ? <p role="status" className="mb-4 text-sm">{message}</p> : null}
      <article className="max-w-xl rounded-xl border border-slate-200 p-5">
        <h2 className="font-bold text-[#071f5c]">Endereço</h2>
        {address.address1 ? (
          <address className="mt-3 not-italic leading-6 text-slate-600">
            {address.firstName} {address.lastName}<br />
            {address.address1}
            {address.neighborhood ? `, ${address.neighborhood}` : ""}
            {address.address2 ? ` - ${address.address2}` : ""}<br />
            {address.city} - {address.state}, {address.postcode}
          </address>
        ) : <p className="mt-3 text-slate-500">Nenhum endereço cadastrado.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsEditing(true)}>
            {address.address1 ? "Editar" : "Adicionar"}
          </Button>
          {address.address1 ? <Button variant="ghost" onClick={() => void remove()}>Excluir</Button> : null}
        </div>
      </article>
      {current ? (
        <form onSubmit={save} className="mt-6 max-w-xl rounded-xl border border-slate-200 p-5">
          <h2 className="text-lg font-bold text-[#071f5c]">
            {current.address1 ? "Editar" : "Adicionar"} endereço
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {keys.map((key) => {
              const isPhone = key === "phone";
              const isPostcode = key === "postcode";
              return (
                <label key={key} className="text-sm font-semibold">
                  {labels[key]}{REQUIRED_KEYS.includes(key) ? " *" : ""}
                  <input
                    required={REQUIRED_KEYS.includes(key)}
                    type={isPhone ? "tel" : "text"}
                    inputMode={isPhone ? "numeric" : undefined}
                    autoComplete={isPhone ? "tel" : undefined}
                    maxLength={isPhone ? 15 : isPostcode ? 9 : undefined}
                    placeholder={isPhone ? "(11) 99999-9999" : isPostcode ? "00000-000" : undefined}
                    value={current[key]}
                    onChange={(event) =>
                      isPostcode
                        ? handlePostalCodeChange(event.target.value)
                        : updateField(key, event.target.value)
                    }
                    className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                  />
                  {isPostcode && isLookingUpAddress ? (
                    <span className="mt-1.5 block text-xs font-normal text-slate-500" role="status">
                      Buscando endereço...
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <div className="mt-5 flex gap-3">
            <Button type="submit">Salvar endereço</Button>
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

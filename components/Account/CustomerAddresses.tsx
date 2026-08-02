"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/UI/Button";
import { formatBrazilianPhone } from "@/lib/formatting/personalData";
import type { CustomerWorkspaceAddress } from "@/lib/customer-workspace/types";

const keys = [
  "firstName", "lastName", "company", "address1", "address2", "city",
  "state", "postcode", "country", "phone",
] as const;
type AddressKey = (typeof keys)[number];

const labels: Record<AddressKey, string> = {
  firstName: "Nome",
  lastName: "Sobrenome",
  company: "Empresa",
  address1: "Endereço",
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

export function CustomerAddresses({
  initialAddresses,
}: {
  initialAddresses: CustomerWorkspaceAddress[];
}) {
  const [addresses, setAddresses] = useState(() => formatAddresses(initialAddresses));
  const [editing, setEditing] = useState<"billing" | "shipping" | null>(null);
  const [message, setMessage] = useState("");
  const current = addresses.find((address) => address.type === editing);

  function updateCurrent(key: AddressKey, value: string) {
    if (!current) return;
    const nextValue = key === "phone" ? formatBrazilianPhone(value) : value;
    setAddresses((values) =>
      values.map((item) =>
        item.id === current.id ? { ...item, [key]: nextValue } : item,
      ),
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setMessage("");
    const payload = Object.fromEntries(keys.map((key) => [key, current[key]]));
    const response = await fetch(`/api/account/workspace/addresses/${current.type}`, {
      method:"PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (response.ok) {
      setAddresses(formatAddresses(body));
      setEditing(null);
      setMessage("Endereço salvo.");
    } else {
      setMessage(body.message || "Não foi possível salvar.");
    }
  }

  async function remove(type: "billing" | "shipping") {
    if (!window.confirm("Remover este endereço?")) return;
    const response = await fetch(`/api/account/workspace/addresses/${type}`, {
      method:"DELETE",
    });
    if (response.ok) {
      setAddresses(formatAddresses(await response.json()));
      setMessage("Endereço removido.");
    }
  }

  async function makePrimary(type: "billing" | "shipping") {
    const response = await fetch(
      `/api/account/workspace/addresses/${type}/primary`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    if (response.ok) {
      setAddresses(formatAddresses(await response.json()));
      setMessage("Endereço principal atualizado.");
    }
  }

  return (
    <div>
      {message ? <p role="status" className="mb-4 text-sm">{message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {addresses.map((address) => (
          <article key={address.id} className="rounded-xl border border-slate-200 p-5">
            <div className="flex justify-between gap-3">
              <h2 className="font-bold text-[#071f5c]">{address.label}</h2>
              {address.isPrimary ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Principal</span> : null}
            </div>
            {address.address1 ? (
              <address className="mt-3 not-italic leading-6 text-slate-600">
                {address.firstName} {address.lastName}<br />
                {address.address1}{address.address2 ? `, ${address.address2}` : ""}<br />
                {address.city} - {address.state}, {address.postcode}
              </address>
            ) : <p className="mt-3 text-slate-500">Nenhum endereço cadastrado.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(address.type)}>{address.address1 ? "Editar" : "Adicionar"}</Button>
              {address.address1 && !address.isPrimary ? <Button variant="ghost" onClick={() => void makePrimary(address.type)}>Definir principal</Button> : null}
              {address.address1 ? <Button variant="ghost" onClick={() => void remove(address.type)}>Excluir</Button> : null}
            </div>
          </article>
        ))}
      </div>
      {current ? (
        <form onSubmit={save} className="mt-6 rounded-xl border border-slate-200 p-5">
          <h2 className="text-lg font-bold text-[#071f5c]">{current.address1 ? "Editar" : "Adicionar"} endereço de {current.label.toLowerCase()}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {keys.map((key) => {
              const isPhone = key === "phone";
              return (
                <label key={key} className="text-sm font-semibold">
                  {labels[key]}{["address1", "city", "postcode"].includes(key) ? " *" : ""}
                  <input
                    required={["address1", "city", "postcode"].includes(key)}
                    type={isPhone ? "tel" : "text"}
                    inputMode={isPhone ? "numeric" : undefined}
                    autoComplete={isPhone ? "tel" : undefined}
                    maxLength={isPhone ? 15 : undefined}
                    placeholder={isPhone ? "(11) 99999-9999" : undefined}
                    value={current[key]}
                    onChange={(event) => updateCurrent(key, event.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                  />
                </label>
              );
            })}
          </div>
          <div className="mt-5 flex gap-3">
            <Button type="submit">Salvar endereço</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "@/hooks/useAccount";
import { customerListsApi } from "./api";
import { CustomerListsContext, type CustomerListsContextValue } from "./context";
import { readStoredCustomerLists, writeStoredCustomerLists } from "./storage";
import { mergeAnonymousCustomerLists } from "./sync";
import {
  CUSTOMER_LIST_TYPES,
  createEmptyCustomerLists,
  type CustomerLists,
  type CustomerListType,
} from "./types";

export function CustomerListsProvider({ children }: { children: ReactNode }) {
  const { status } = useAccount();
  const [lists, setLists] = useState<CustomerLists>(createEmptyCustomerLists);
  const [isReady, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (status === "authenticated") {
      const entries = await Promise.all(
        CUSTOMER_LIST_TYPES.map(async (listType) => [
          listType,
          (await customerListsApi.list(listType)).map((item) => item.productId),
        ] as const),
      );
      setLists(Object.fromEntries(entries) as CustomerLists);
    } else if (status === "anonymous") {
      setLists(readStoredCustomerLists());
    }
    setReady(status !== "loading");
  }, [status]);

  const sync = useCallback(async () => {
    if (status !== "authenticated") return;
    setLists(await mergeAnonymousCustomerLists());
    setReady(true);
  }, [status]);

  useEffect(() => {
    void Promise.resolve()
      .then(() => (status === "authenticated" ? sync() : refresh()))
      .catch(() => setReady(true));
  }, [refresh, status, sync]);

  const update = useCallback(
    async (listType: CustomerListType, productId: number, shouldAdd: boolean) => {
      if (!Number.isInteger(productId) || productId <= 0) return;
      const previous = lists;
      const current = previous[listType];
      const nextIds = shouldAdd
        ? [...new Set([...current, productId])]
        : current.filter((id) => id !== productId);
      const next = { ...previous, [listType]: nextIds };
      setLists(next);

      if (status === "authenticated") {
        try {
          const records = shouldAdd
            ? await customerListsApi.add(listType, productId)
            : await customerListsApi.remove(listType, productId);
          setLists((value) => ({
            ...value,
            [listType]: records.map((item) => item.productId),
          }));
        } catch (error) {
          setLists(previous);
          throw error;
        }
      } else {
        writeStoredCustomerLists(next);
      }
    },
    [lists, status],
  );

  const value = useMemo<CustomerListsContextValue>(
    () => ({
      lists,
      isReady,
      getList: (listType) => lists[listType],
      add: (listType, productId) => update(listType, productId, true),
      remove: (listType, productId) => update(listType, productId, false),
      toggle: (listType, productId) =>
        update(listType, productId, !lists[listType].includes(productId)),
      contains: (listType, productId) => lists[listType].includes(productId),
      count: (listType) => lists[listType].length,
      sync,
      refresh,
    }),
    [isReady, lists, refresh, sync, update],
  );

  return (
    <CustomerListsContext.Provider value={value}>
      {children}
    </CustomerListsContext.Provider>
  );
}

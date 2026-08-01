"use client";

import { useContext } from "react";
import { CustomerListsContext, type CustomerListsContextValue } from "./context";

export function useCustomerLists(): CustomerListsContextValue {
  const value = useContext(CustomerListsContext);
  if (!value) {
    throw new Error(
      "useCustomerLists must be used inside CustomerListsProvider",
    );
  }
  return value;
}

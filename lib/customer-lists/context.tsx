"use client";

import { createContext } from "react";
import type { CustomerLists, CustomerListType } from "./types";

export interface CustomerListsContextValue {
  lists: CustomerLists;
  isReady: boolean;
  getList(listType: CustomerListType): number[];
  add(listType: CustomerListType, productId: number): Promise<void>;
  remove(listType: CustomerListType, productId: number): Promise<void>;
  toggle(listType: CustomerListType, productId: number): Promise<void>;
  contains(listType: CustomerListType, productId: number): boolean;
  count(listType: CustomerListType): number;
  sync(): Promise<void>;
  refresh(): Promise<void>;
}

export const CustomerListsContext =
  createContext<CustomerListsContextValue | null>(null);

"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "@/hooks/useAccount";
import { favoritesApi } from "./favorites-api";
import { mergeAnonymousFavorites } from "./favorites-sync";
import { readStoredFavorites, writeStoredFavorites } from "./favorites-storage";
interface Value { favorites: number[]; count: number; isReady: boolean; addFavorite(id:number):Promise<void>; removeFavorite(id:number):Promise<void>; toggleFavorite(id:number):Promise<void>; isFavorite(id:number):boolean; sync():Promise<void>; refresh():Promise<void>; }
const Context = createContext<Value | null>(null);
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { status } = useAccount(); const [favorites, setFavorites] = useState<number[]>([]); const [isReady, setReady] = useState(false);
  const refresh = useCallback(async () => { if (status === "authenticated") setFavorites((await favoritesApi.list()).map((x)=>x.productId)); else if (status === "anonymous") setFavorites(readStoredFavorites()); setReady(status !== "loading"); }, [status]);
  const sync = useCallback(async () => { if (status === "authenticated") { setFavorites(await mergeAnonymousFavorites()); setReady(true); } }, [status]);
  useEffect(() => { void Promise.resolve().then(() => status === "authenticated" ? sync() : refresh()).catch(() => setReady(true)); }, [refresh, status, sync]);
  const update = useCallback(async (id:number, add:boolean) => { if (!Number.isInteger(id)||id<=0) return; const previous=favorites; const next=add?[...new Set([...previous,id])]:previous.filter((x)=>x!==id); setFavorites(next); if(status==="authenticated"){try{await(add?favoritesApi.add(id):favoritesApi.remove(id));}catch(error){setFavorites(previous);throw error;}}else writeStoredFavorites(next); },[favorites,status]);
  const value=useMemo<Value>(()=>({favorites,count:favorites.length,isReady,addFavorite:(id)=>update(id,true),removeFavorite:(id)=>update(id,false),toggleFavorite:(id)=>update(id,!favorites.includes(id)),isFavorite:(id)=>favorites.includes(id),sync,refresh}),[favorites,isReady,refresh,sync,update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFavorites(){const value=useContext(Context);if(!value)throw new Error("useFavorites must be used inside FavoritesProvider");return value;}

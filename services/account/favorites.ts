import { FAVORITES_REST_BASE_PATH, AccountServiceError, getAccountClientConfig, requestAccountEndpoint } from "./client";
import type { FavoriteRecord } from "@/lib/favorites/favorites-types";
function parse(value: unknown): FavoriteRecord[] {
  if (!Array.isArray(value)) throw new AccountServiceError(502, "Invalid favorites response");
  return value.filter((item): item is FavoriteRecord => typeof item === "object" && item !== null && Number.isInteger((item as FavoriteRecord).productId) && typeof (item as FavoriteRecord).createdAt === "string");
}
async function call(token:string, method:"GET"|"POST"|"PUT"|"DELETE", route:"/favorites"|`/favorites/${number}`|"/favorites/sync", rawBody="") {
  const result=await requestAccountEndpoint({config:getAccountClientConfig(),method,route,basePath:FAVORITES_REST_BASE_PATH,rawBody,sessionToken:token});
  if(result.status<200||result.status>=300) throw new AccountServiceError(result.status===401?401:502,"Favorites unavailable");
  return result.body;
}
export async function listFavorites(token:string){return parse(await call(token,"GET","/favorites"));}
export async function addFavorite(token:string,id:number){await call(token,"POST","/favorites",JSON.stringify({productId:id}));return listFavorites(token);}
export async function removeFavorite(token:string,id:number){await call(token,"DELETE",`/favorites/${id}`);return listFavorites(token);}
export async function syncFavorites(token:string,ids:number[]){return parse(await call(token,"PUT","/favorites/sync",JSON.stringify(ids)));}

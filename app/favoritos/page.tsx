import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header/Header";
import { FavoritesPageClient } from "@/components/Favorites/FavoritesPageClient";
import { Container } from "@/components/UI/Container";
export const metadata:Metadata={title:"Meus favoritos | Persi Materiais",description:"Consulte os produtos que você salvou na Persi Materiais.",robots:{index:false,follow:false}};
export default function FavoritesPage(){return <><Header/><main className="py-6 sm:py-10"><Container><nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/" className="hover:text-secondary">Home</Link><span aria-hidden="true" className="mx-2">›</span><span aria-current="page">Favoritos</span></nav><h1 className="mt-5 text-2xl font-bold text-primary-hover sm:text-3xl">Meus favoritos</h1><div className="mt-6"><FavoritesPageClient/></div></Container></main></>}

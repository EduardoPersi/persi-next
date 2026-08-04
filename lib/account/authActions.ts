"use server";

import { redirect } from "next/navigation";

export async function signInWithGoogle() {
  redirect("/api/auth/google/start");
}

export async function signInWithFacebook() {
  redirect("/api/auth/facebook/start");
}

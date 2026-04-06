import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey);

export const FUNCTIONS_URL = `${url}/functions/v1`;

export async function callFunction<T>(
  name: string,
  body: Record<string, unknown>,
  token: string
): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
  return data as T;
}

export async function callFunctionGet<T>(
  name: string,
  token: string,
  params?: Record<string, string>
): Promise<T> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${FUNCTIONS_URL}/${name}${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
  return data as T;
}

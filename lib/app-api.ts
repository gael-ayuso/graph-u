import "server-only";

import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/lib/db";
import { getCurrentUserProfile } from "@/lib/users/current-user";

export type AppQuery = {
  db: ReturnType<typeof getDb>;
  userId: string;
  searchParams: URLSearchParams;
};

export class AppQueryError extends Error {
  constructor(message: string, public readonly status: 400 | 404) {
    super(message);
  }
}

export async function readApp(request: Request, query: (context: AppQuery) => Promise<unknown>) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getCurrentUserProfile();
    if (!user) return Response.json({ error: "No autorizado." }, { status: 401, headers });

    const data = await query({
      db: getDb(), userId: user.id, searchParams: new URL(request.url).searchParams,
    });
    return Response.json(data, { headers });
  } catch (error) {
    // Clerk/Next.js can throw request-time rendering and redirect signals.
    unstable_rethrow(error);
    if (error instanceof AppQueryError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("Unable to query application data.");
    return Response.json({ error: "Los datos no están disponibles temporalmente." }, { status: 503, headers });
  }
}

function integerParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const values = params.getAll(name);
  if (!values.length) return fallback;
  const value = values[0];
  if (values.length !== 1 || !/^\d+$/.test(value)) {
    throw new AppQueryError(`El parámetro ${name} debe ser un entero entre ${min} y ${max}.`, 400);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new AppQueryError(`El parámetro ${name} debe ser un entero entre ${min} y ${max}.`, 400);
  }
  return number;
}

export function pagination(params: URLSearchParams) {
  const limit = integerParam(params, "limit", 20, 1, 100);
  const offset = integerParam(params, "offset", 0, 0, 10_000);
  return { limit, offset, take: limit + 1, skip: offset };
}

export function pageResult<T>(rows: T[], page: ReturnType<typeof pagination>) {
  const hasMore = rows.length > page.limit;
  const nextOffset = page.offset + page.limit;
  return {
    items: rows.slice(0, page.limit),
    pagination: {
      limit: page.limit, offset: page.offset, hasMore,
      nextOffset: hasMore && nextOffset <= 10_000 ? nextOffset : null,
    },
  };
}

export function resourceId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppQueryError("El identificador debe ser un UUID válido.", 400);
  }
  return value.toLowerCase();
}

export function notFound(): never {
  throw new AppQueryError("Recurso no encontrado.", 404);
}

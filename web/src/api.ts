import { AdminUser, Ticket, TicketDetail } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

type RequestInitExt = RequestInit & {
  token?: string;
};

async function request<T>(path: string, init: RequestInitExt = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  if (response.headers.get("content-type")?.includes("application/pdf")) {
    return (await response.blob()) as T;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string): Promise<{ access_token: string }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function listTickets(token: string, params?: Record<string, string | number>): Promise<Ticket[]> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : "";
  return request(`/tickets${query}`, { token });
}

export async function createTicket(token: string, payload: Record<string, unknown>): Promise<Ticket> {
  return request("/tickets", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function getTicketDetail(token: string, ticketId: string): Promise<TicketDetail> {
  return request(`/tickets/${ticketId}`, { token });
}

export async function qualifyTicket(
  token: string,
  ticketId: string,
  payload: { task_class?: number; proof_policy_json?: Record<string, unknown> }
): Promise<Ticket> {
  return request(`/tickets/${ticketId}/qualify`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function publishTicket(token: string, ticketId: string): Promise<Ticket> {
  return request(`/tickets/${ticketId}/publish`, {
    method: "POST",
    token
  });
}

export async function acceptTicket(token: string, ticketId: string): Promise<Ticket> {
  return request(`/tickets/${ticketId}/accept`, {
    method: "POST",
    token
  });
}

export async function submitProof(
  token: string,
  ticketId: string,
  payload: {
    notes: string;
    checklist_answers_json: string;
    gps_lat: string;
    gps_lng: string;
    captured_at: string;
    files: File[];
  }
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("notes", payload.notes);
  formData.append("checklist_answers_json", payload.checklist_answers_json);
  if (payload.gps_lat) {
    formData.append("gps_lat", payload.gps_lat);
  }
  if (payload.gps_lng) {
    formData.append("gps_lng", payload.gps_lng);
  }
  if (payload.captured_at) {
    formData.append("captured_at", payload.captured_at);
  }
  for (const file of payload.files) {
    formData.append("files", file);
  }

  return request(`/tickets/${ticketId}/proofs`, {
    method: "POST",
    token,
    body: formData
  });
}

export async function qaDecision(
  token: string,
  proofId: string,
  payload: { decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "ESCALATE"; comment: string }
): Promise<Record<string, unknown>> {
  return request(`/proofs/${proofId}/qa`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function downloadReport(token: string, ticketId: string): Promise<Blob> {
  return request(`/tickets/${ticketId}/report.pdf`, { token });
}

export async function listUsers(token: string): Promise<AdminUser[]> {
  return request("/admin/users", { token });
}

export async function updateUserRole(token: string, userId: string, role: string): Promise<AdminUser> {
  return request(`/admin/users/${userId}/role`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ role })
  });
}

export function decodeJwt(token: string): { id: string; email: string; role: string } {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

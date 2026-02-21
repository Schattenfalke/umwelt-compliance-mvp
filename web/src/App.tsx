import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptTicket,
  createProject,
  createTemplate,
  createTicket,
  deleteTemplate,
  decodeJwt,
  downloadProofFile,
  downloadProjectReport,
  downloadReport,
  getAdminMetrics,
  getTicketDetail,
  listProjects,
  listQaQueue,
  listTickets,
  listTemplates,
  listUsers,
  login,
  publishTicket,
  qaDecision,
  qualifyTicket,
  submitProof,
  updateTemplate,
  updateUserRole
} from "./api";
import { AdminMetrics, AdminUser, Project, QaQueueEntry, Role, Ticket, TicketDetail, TicketTemplate } from "./types";

type View = "tickets" | "feed" | "qa" | "admin";

const roleEmails: Record<Role, string> = {
  ADMIN: "admin@example.com",
  REQUESTER: "requester@example.com",
  WORKER: "worker@example.com",
  QA: "qa@example.com"
};

const defaultCreateTicket = {
  title: "",
  description: "",
  category: "",
  task_class: 1,
  location_lat: "52.52",
  location_lng: "13.405",
  geofence_radius_m: "25",
  time_window_start: "",
  time_window_end: "",
  deadline_at: "",
  proof_policy_json: '{"min_photos":1,"require_gps":true,"required_fields":["checklist_complete"]}',
  safety_flags_json: '{"public_access_only":true,"permit_required":false,"no_trespass":true}'
};

const defaultProof = {
  notes: "",
  checklist_answers_json: '{"checklist_complete":true}',
  gps_lat: "",
  gps_lng: "",
  captured_at: "",
  files: [] as File[]
};

const defaultTemplateForm = {
  name: "",
  category: "",
  task_class: 1,
  checklist_json: '{"fields":[]}',
  proof_policy_json: '{"min_photos":1,"require_gps":true}',
  default_geofence_radius_m: "25"
};

const defaultProjectForm = {
  name: "",
  description: ""
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatSeconds(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return `${Math.round(value)} s`;
}

function formatPercent(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return `${(value * 100).toFixed(1)} %`;
}

function parseCoordinate(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildStaticMapUrl(params: {
  centerLat: number;
  centerLng: number;
  markers: Array<{ lat: number; lng: number; color: "red" | "blue" }>;
  zoom?: number;
  width?: number;
  height?: number;
}): string {
  const markerString = params.markers
    .map((marker) => `${marker.lat.toFixed(6)},${marker.lng.toFixed(6)},${marker.color}`)
    .join("|");

  const search = new URLSearchParams({
    center: `${params.centerLat.toFixed(6)},${params.centerLng.toFixed(6)}`,
    zoom: String(params.zoom ?? 14),
    size: `${params.width ?? 640}x${params.height ?? 320}`,
    markers: markerString
  });

  return `https://staticmap.openstreetmap.de/staticmap.php?${search.toString()}`;
}

function buildProofMapUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) {
    return null;
  }
  return buildStaticMapUrl({
    centerLat: lat,
    centerLng: lng,
    markers: [{ lat, lng, color: "red" }],
    zoom: 16,
    width: 520,
    height: 220
  });
}

function App() {
  const [email, setEmail] = useState(roleEmails.REQUESTER);
  const [password, setPassword] = useState("demo123");
  const [token, setToken] = useState<string>("");
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [createTicketForm, setCreateTicketForm] = useState(defaultCreateTicket);
  const [proofForm, setProofForm] = useState(defaultProof);
  const [qaComment, setQaComment] = useState("");

  const [workerLat, setWorkerLat] = useState("52.52");
  const [workerLng, setWorkerLng] = useState("13.405");
  const [workerRadius, setWorkerRadius] = useState("10");

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateForm, setTemplateForm] = useState(defaultTemplateForm);
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [ticketProjectFilter, setTicketProjectFilter] = useState<string>("");
  const [ticketProjectId, setTicketProjectId] = useState<string>("");
  const [qaFlagFilter, setQaFlagFilter] = useState<"all" | "geo_fail" | "time_fail" | "exif_missing">("all");
  const [qaQueueEntries, setQaQueueEntries] = useState<QaQueueEntry[]>([]);
  const [proofImageUrls, setProofImageUrls] = useState<Record<string, string>>({});

  const selectedTicket = useMemo(() => tickets.find((t) => t.id === selectedTicketId) ?? null, [tickets, selectedTicketId]);
  const createTicketMapUrl = useMemo(() => {
    const lat = parseCoordinate(createTicketForm.location_lat);
    const lng = parseCoordinate(createTicketForm.location_lng);
    if (lat == null || lng == null) {
      return null;
    }
    return buildStaticMapUrl({
      centerLat: lat,
      centerLng: lng,
      markers: [{ lat, lng, color: "red" }],
      zoom: 16,
      width: 640,
      height: 250
    });
  }, [createTicketForm.location_lat, createTicketForm.location_lng]);
  const workerMapUrl = useMemo(() => {
    const lat = parseCoordinate(workerLat);
    const lng = parseCoordinate(workerLng);
    if (lat == null || lng == null) {
      return null;
    }

    const ticketMarkers = tickets
      .slice(0, 20)
      .filter((ticket) => Number.isFinite(ticket.location_lat) && Number.isFinite(ticket.location_lng))
      .map((ticket) => ({ lat: ticket.location_lat, lng: ticket.location_lng, color: "red" as const }));

    return buildStaticMapUrl({
      centerLat: lat,
      centerLng: lng,
      markers: [{ lat, lng, color: "blue" }, ...ticketMarkers],
      zoom: 13,
      width: 640,
      height: 280
    });
  }, [workerLat, workerLng, tickets]);

  const setSession = (jwt: string) => {
    const decoded = decodeJwt(jwt);
    setToken(jwt);
    setUserRole(decoded.role as Role);
    setUserEmail(decoded.email);

    if (decoded.role === "WORKER") {
      setView("feed");
    } else if (decoded.role === "QA") {
      setView("qa");
    } else if (decoded.role === "ADMIN") {
      setView("admin");
    } else {
      setView("tickets");
    }
  };

  const resetMessages = () => {
    setError("");
    setMessage("");
  };

  const loadTickets = useCallback(async () => {
    if (!token || !userRole) {
      return;
    }

    if (view === "qa") {
      setTickets([]);
      return;
    }

    let params: Record<string, string | number> | undefined;
    if (view === "feed") {
      params = {
        near_lat: workerLat,
        near_lng: workerLng,
        near_radius_km: workerRadius
      };
    }
    if (view === "tickets" && ticketProjectFilter) {
      params = { project_id: ticketProjectFilter };
    }

    const data = await listTickets(token, params);
    setTickets(data);

    if (selectedTicketId && !data.some((item) => item.id === selectedTicketId)) {
      setSelectedTicketId("");
      setTicketDetail(null);
    }
  }, [token, userRole, view, workerLat, workerLng, workerRadius, selectedTicketId, ticketProjectFilter]);

  const loadTicketDetail = useCallback(
    async (ticketId: string) => {
      if (!token || !ticketId) {
        return;
      }
      const detail = await getTicketDetail(token, ticketId);
      setTicketDetail(detail);
    },
    [token]
  );

  const loadAdminUsers = useCallback(async () => {
    if (!token || userRole !== "ADMIN") {
      return;
    }
    const users = await listUsers(token);
    setAdminUsers(users);
  }, [token, userRole]);

  const loadTemplates = useCallback(async () => {
    if (!token) {
      return;
    }
    const data = await listTemplates(token);
    setTemplates(data);
  }, [token]);

  const loadAdminMetrics = useCallback(async () => {
    if (!token || userRole !== "ADMIN") {
      return;
    }
    const metrics = await getAdminMetrics(token);
    setAdminMetrics(metrics);
  }, [token, userRole]);

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }
    const data = await listProjects(token);
    setProjects(data);
  }, [token]);

  const loadQaQueue = useCallback(async () => {
    if (!token || userRole !== "QA") {
      setQaQueueEntries([]);
      return;
    }
    const entries = await listQaQueue(token, qaFlagFilter);
    setQaQueueEntries(entries);
  }, [token, userRole, qaFlagFilter]);

  useEffect(() => {
    if (!token) {
      return;
    }

    resetMessages();
    setLoading(true);

    Promise.all([loadTickets(), loadAdminUsers(), loadTemplates(), loadAdminMetrics(), loadProjects(), loadQaQueue()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, view, reloadToken, loadTickets, loadAdminUsers, loadTemplates, loadAdminMetrics, loadProjects, loadQaQueue]);

  useEffect(() => {
    if (!selectedTicketId) {
      setTicketDetail(null);
      return;
    }
    loadTicketDetail(selectedTicketId).catch((err) => setError(err.message));
  }, [selectedTicketId, reloadToken, loadTicketDetail]);

  useEffect(() => {
    let active = true;
    const localUrls: string[] = [];

    const revokeCurrent = () => {
      setProofImageUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
    };

    if (view !== "qa" || userRole !== "QA" || !token || !ticketDetail) {
      revokeCurrent();
      return;
    }

    const files = ticketDetail.proofs.flatMap((proof) =>
      (proof.files ?? []).map((file) => ({
        proofId: proof.id,
        fileId: file.id
      }))
    );

    if (files.length === 0) {
      revokeCurrent();
      return;
    }

    const loadImages = async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        files.map(async (fileRef) => {
          try {
            const blob = await downloadProofFile(token, fileRef.proofId, fileRef.fileId);
            const objectUrl = URL.createObjectURL(blob);
            localUrls.push(objectUrl);
            next[fileRef.fileId] = objectUrl;
          } catch (_error) {
            // Intentionally ignore single-file failures to keep the review usable.
          }
        })
      );

      if (!active) {
        localUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      setProofImageUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return next;
      });
    };

    loadImages().catch((err) => {
      if (active) {
        setError((err as Error).message);
      }
    });

    return () => {
      active = false;
      localUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [view, userRole, token, ticketDetail, reloadToken]);

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      const response = await login(email, password);
      setSession(response.access_token);
      setMessage("Login erfolgreich.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onCreateTicket = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    resetMessages();
    setLoading(true);

    try {
      await createTicket(token, {
        project_id: ticketProjectId || null,
        template_id: selectedTemplateId || null,
        title: createTicketForm.title,
        description: createTicketForm.description,
        category: createTicketForm.category,
        task_class: Number(createTicketForm.task_class),
        location_lat: Number(createTicketForm.location_lat),
        location_lng: Number(createTicketForm.location_lng),
        geofence_radius_m: Number(createTicketForm.geofence_radius_m),
        time_window_start: createTicketForm.time_window_start || null,
        time_window_end: createTicketForm.time_window_end || null,
        deadline_at: createTicketForm.deadline_at,
        proof_policy_json: JSON.parse(createTicketForm.proof_policy_json),
        safety_flags_json: JSON.parse(createTicketForm.safety_flags_json)
      });
      setMessage("Ticket erstellt.");
      setCreateTicketForm(defaultCreateTicket);
      setSelectedTemplateId("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onQualify = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await qualifyTicket(token, selectedTicket.id, {
        task_class: selectedTicket.task_class,
        proof_policy_json: selectedTicket.proof_policy_json
      });
      setMessage("Ticket qualifiziert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onPublish = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await publishTicket(token, selectedTicket.id);
      setMessage("Ticket publiziert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onAccept = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await acceptTicket(token, selectedTicket.id);
      setMessage("Ticket angenommen.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmitProof = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await submitProof(token, selectedTicket.id, proofForm);
      setMessage("Proof eingereicht.");
      setProofForm(defaultProof);
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onQaDecision = async (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "ESCALATE", proofId: string) => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await qaDecision(token, proofId, { decision, comment: qaComment });
      setMessage(`QA Entscheidung gespeichert: ${decision}`);
      setQaComment("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadReport = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const blob = await downloadReport(token, selectedTicket.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("Report geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadProjectReport = async () => {
    if (!token || !ticketProjectFilter) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const blob = await downloadProjectReport(token, ticketProjectFilter);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("Projekt-Report geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await createProject(token, {
        name: projectForm.name,
        description: projectForm.description
      });
      setProjectForm(defaultProjectForm);
      setMessage("Projekt erstellt.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onUpdateUserRole = async (userId: string, role: Role) => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await updateUserRole(token, userId, role);
      setMessage("Rolle aktualisiert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onApplyTemplateToTicketForm = () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) {
      return;
    }
    setCreateTicketForm((current) => ({
      ...current,
      category: template.category,
      task_class: template.task_class,
      geofence_radius_m: String(template.default_geofence_radius_m),
      proof_policy_json: JSON.stringify(template.proof_policy_json)
    }));
  };

  const onSelectTemplateForEdit = (template: TicketTemplate) => {
    setSelectedTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      category: template.category,
      task_class: template.task_class,
      checklist_json: JSON.stringify(template.checklist_json),
      proof_policy_json: JSON.stringify(template.proof_policy_json),
      default_geofence_radius_m: String(template.default_geofence_radius_m)
    });
  };

  const onSaveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || userRole !== "ADMIN") {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const payload = {
        name: templateForm.name,
        category: templateForm.category,
        task_class: Number(templateForm.task_class),
        checklist_json: JSON.parse(templateForm.checklist_json),
        proof_policy_json: JSON.parse(templateForm.proof_policy_json),
        default_geofence_radius_m: Number(templateForm.default_geofence_radius_m)
      };

      if (selectedTemplateId && templates.some((item) => item.id === selectedTemplateId)) {
        await updateTemplate(token, selectedTemplateId, payload);
        setMessage("Template aktualisiert.");
      } else {
        await createTemplate(token, payload);
        setMessage("Template erstellt.");
      }

      setTemplateForm(defaultTemplateForm);
      setSelectedTemplateId("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDeleteTemplate = async (templateId: string) => {
    if (!token || userRole !== "ADMIN") {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await deleteTemplate(token, templateId);
      setMessage("Template geloescht.");
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId("");
        setTemplateForm(defaultTemplateForm);
      }
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    Object.values(proofImageUrls).forEach((url) => URL.revokeObjectURL(url));
    setToken("");
    setUserRole(null);
    setUserEmail("");
    setTickets([]);
    setSelectedTicketId("");
    setTicketDetail(null);
    setAdminUsers([]);
    setTemplates([]);
    setSelectedTemplateId("");
    setTemplateForm(defaultTemplateForm);
    setAdminMetrics(null);
    setProjects([]);
    setProjectForm(defaultProjectForm);
    setTicketProjectFilter("");
    setTicketProjectId("");
    setQaQueueEntries([]);
    setQaFlagFilter("all");
    setProofImageUrls({});
  };

  if (!token || !userRole) {
    return (
      <main className="shell login-shell">
        <section className="card login-card">
          <h1>Umwelt Compliance MVP</h1>
          <p>Login via Demo-User gemaess MVP-Setup.</p>
          <form onSubmit={onLogin} className="form-grid">
            <label>
              Rolle-Vorlage
              <select
                value={email}
                onChange={(e) => {
                  const selectedEmail = e.target.value;
                  setEmail(selectedEmail);
                }}
              >
                {Object.entries(roleEmails).map(([role, defaultEmail]) => (
                  <option value={defaultEmail} key={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Passwort
              <input value={password} onChange={(e) => setPassword(e.target.value)} required type="password" />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Bitte warten..." : "Einloggen"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar card">
        <div>
          <h2>Umwelt Compliance MVP</h2>
          <p>
            {userEmail} ({userRole})
          </p>
        </div>
        <nav className="nav-actions">
          {(userRole === "REQUESTER" || userRole === "ADMIN") && (
            <button onClick={() => setView("tickets")} className={view === "tickets" ? "active" : ""}>
              Tickets
            </button>
          )}
          {userRole === "WORKER" && (
            <button onClick={() => setView("feed")} className={view === "feed" ? "active" : ""}>
              Mission Feed
            </button>
          )}
          {userRole === "QA" && (
            <button onClick={() => setView("qa")} className={view === "qa" ? "active" : ""}>
              QA Queue
            </button>
          )}
          {userRole === "ADMIN" && (
            <button onClick={() => setView("admin")} className={view === "admin" ? "active" : ""}>
              Admin
            </button>
          )}
          <button onClick={logout}>Logout</button>
        </nav>
      </header>

      {(message || error) && (
        <section className="card">
          {message && <p className="ok">{message}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {view === "tickets" && (userRole === "REQUESTER" || userRole === "ADMIN") && (
        <section className="grid-two">
          <article className="card">
            <h3>R-01 Ticket Liste</h3>
            <div className="inline-fields">
              <label>
                Projektfilter
                <select value={ticketProjectFilter} onChange={(e) => setTicketProjectFilter(e.target.value)}>
                  <option value="">- alle Projekte -</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setReloadToken((v) => v + 1)}>
                Filter anwenden
              </button>
              <button type="button" onClick={onDownloadProjectReport} disabled={!ticketProjectFilter}>
                Projekt-Report (PDF)
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Titel</th>
                    <th>Kategorie</th>
                    <th>Klasse</th>
                    <th>Status</th>
                    <th>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={ticket.id === selectedTicketId ? "selected-row" : ""}
                      onClick={() => setSelectedTicketId(ticket.id)}
                    >
                      <td>{ticket.title}</td>
                      <td>{ticket.category}</td>
                      <td>{ticket.task_class}</td>
                      <td>{ticket.status}</td>
                      <td>{formatDate(ticket.deadline_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card">
            <h3>R-02 Neues Ticket</h3>
            <form onSubmit={onCreateTicket} className="form-grid">
              <label>
                Projekt (optional)
                <select value={ticketProjectId} onChange={(e) => setTicketProjectId(e.target.value)}>
                  <option value="">- ohne Projekt -</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Template (optional)
                <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                  <option value="">- kein Template -</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onApplyTemplateToTicketForm} disabled={!selectedTemplateId}>
                Template-Werte uebernehmen
              </button>
              <label>
                Titel
                <input
                  value={createTicketForm.title}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, title: e.target.value }))}
                  required
                />
              </label>
              <label>
                Beschreibung
                <textarea
                  value={createTicketForm.description}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, description: e.target.value }))}
                />
              </label>
              <label>
                Kategorie
                <input
                  value={createTicketForm.category}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, category: e.target.value }))}
                  required
                />
              </label>
              <label>
                Task-Klasse
                <select
                  value={createTicketForm.task_class}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, task_class: Number(e.target.value) }))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label>
                Lat
                <input
                  type="number"
                  step="0.000001"
                  value={createTicketForm.location_lat}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, location_lat: e.target.value }))}
                  required
                />
              </label>
              <label>
                Lng
                <input
                  type="number"
                  step="0.000001"
                  value={createTicketForm.location_lng}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, location_lng: e.target.value }))}
                  required
                />
              </label>
              {createTicketMapUrl && (
                <div className="map-block">
                  <p className="map-caption">Standort-Vorschau (R-02)</p>
                  <img src={createTicketMapUrl} alt="Ticket-Standort auf Karte" className="map-image" />
                </div>
              )}
              <label>
                Geofence Radius (m)
                <input
                  type="number"
                  value={createTicketForm.geofence_radius_m}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, geofence_radius_m: e.target.value }))}
                  required
                />
              </label>
              <label>
                Time Window Start (optional)
                <input
                  type="datetime-local"
                  value={createTicketForm.time_window_start}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_start: e.target.value }))}
                />
              </label>
              <label>
                Time Window End (optional)
                <input
                  type="datetime-local"
                  value={createTicketForm.time_window_end}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_end: e.target.value }))}
                />
              </label>
              <label>
                Deadline
                <input
                  type="datetime-local"
                  value={createTicketForm.deadline_at}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, deadline_at: e.target.value }))}
                  required
                />
              </label>
              <label>
                Proof Policy JSON
                <textarea
                  value={createTicketForm.proof_policy_json}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, proof_policy_json: e.target.value }))}
                  required
                />
              </label>
              <label>
                Safety Flags JSON
                <textarea
                  value={createTicketForm.safety_flags_json}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, safety_flags_json: e.target.value }))}
                  required
                />
              </label>
              <button type="submit" disabled={loading}>
                Ticket erstellen
              </button>
            </form>

            <h4>Projekt anlegen</h4>
            <form onSubmit={onCreateProject} className="form-grid">
              <label>
                Projektname
                <input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((v) => ({ ...v, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                Beschreibung
                <textarea
                  value={projectForm.description}
                  onChange={(e) => setProjectForm((v) => ({ ...v, description: e.target.value }))}
                />
              </label>
              <button type="submit" disabled={loading}>
                Projekt speichern
              </button>
            </form>
          </article>

          <article className="card full-width">
            <h3>R-03 Ticket Detail</h3>
            {!ticketDetail && <p>Ticket in der Liste auswaehlen.</p>}
            {ticketDetail && (
              <>
                <p>
                  <strong>Status:</strong> {ticketDetail.status}
                </p>
                <p>
                  <strong>Proofs:</strong> {ticketDetail.proofs.length}
                </p>
                <div className="button-row">
                  <button onClick={onDownloadReport}>Report (PDF)</button>
                  {userRole === "ADMIN" && ticketDetail.status === "NEW" && <button onClick={onQualify}>Qualify</button>}
                  {userRole === "ADMIN" && (ticketDetail.status === "QUALIFIED" || ticketDetail.status === "REJECTED") && (
                    <button onClick={onPublish}>Publish</button>
                  )}
                </div>
                <h4>Timeline</h4>
                <ul>
                  {ticketDetail.status_events.map((event) => (
                    <li key={event.id}>
                      {formatDate(event.created_at)} | {event.from_status ?? "-"} -&gt; {event.to_status} ({event.event_type})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </section>
      )}

      {view === "feed" && userRole === "WORKER" && (
        <section className="grid-two">
          <article className="card">
            <h3>W-01 Mission Feed</h3>
            <div className="inline-fields">
              <label>
                Lat
                <input value={workerLat} onChange={(e) => setWorkerLat(e.target.value)} />
              </label>
              <label>
                Lng
                <input value={workerLng} onChange={(e) => setWorkerLng(e.target.value)} />
              </label>
              <label>
                Distanz km
                <input value={workerRadius} onChange={(e) => setWorkerRadius(e.target.value)} />
              </label>
              <button onClick={() => setReloadToken((v) => v + 1)}>Feed laden</button>
            </div>
            {workerMapUrl && (
              <div className="map-block">
                <p className="map-caption">W-01 Karte (blau = Worker, rot = Missionen)</p>
                <img src={workerMapUrl} alt="Mission Feed Karte mit Worker und Tickets" className="map-image" />
              </div>
            )}
            <ul className="list">
              {tickets.map((ticket) => (
                <li key={ticket.id} onClick={() => setSelectedTicketId(ticket.id)} className={ticket.id === selectedTicketId ? "active" : ""}>
                  <strong>{ticket.title}</strong> | {ticket.category} | {ticket.status}
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h3>W-02 / W-03 Ticket Detail & Active Ticket</h3>
            {!selectedTicket && <p>Ticket aus dem Feed auswaehlen.</p>}
            {selectedTicket && (
              <>
                <p>
                  <strong>{selectedTicket.title}</strong> ({selectedTicket.status})
                </p>
                <p>
                  Geofence: {selectedTicket.geofence_radius_m}m | Deadline: {formatDate(selectedTicket.deadline_at)}
                </p>
                <p>Proof Policy: {JSON.stringify(selectedTicket.proof_policy_json)}</p>
                <p>Safety: {JSON.stringify(selectedTicket.safety_flags_json)}</p>

                {selectedTicket.status === "PUBLISHED" && <button onClick={onAccept}>Annehmen</button>}

                {(selectedTicket.status === "ACCEPTED" ||
                  selectedTicket.status === "NEEDS_CHANGES" ||
                  selectedTicket.status === "PROOF_SUBMITTED") && (
                  <form onSubmit={onSubmitProof} className="form-grid">
                    <label>
                      Notes
                      <textarea value={proofForm.notes} onChange={(e) => setProofForm((v) => ({ ...v, notes: e.target.value }))} />
                    </label>
                    <label>
                      Checkliste JSON
                      <textarea
                        value={proofForm.checklist_answers_json}
                        onChange={(e) => setProofForm((v) => ({ ...v, checklist_answers_json: e.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      GPS Lat
                      <input value={proofForm.gps_lat} onChange={(e) => setProofForm((v) => ({ ...v, gps_lat: e.target.value }))} />
                    </label>
                    <label>
                      GPS Lng
                      <input value={proofForm.gps_lng} onChange={(e) => setProofForm((v) => ({ ...v, gps_lng: e.target.value }))} />
                    </label>
                    <label>
                      Captured At
                      <input
                        type="datetime-local"
                        value={proofForm.captured_at}
                        onChange={(e) => setProofForm((v) => ({ ...v, captured_at: e.target.value }))}
                      />
                    </label>
                    <label>
                      Fotos
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => setProofForm((v) => ({ ...v, files: Array.from(e.target.files ?? []) }))}
                        required
                      />
                    </label>
                    <button type="submit" disabled={loading}>
                      Proof submitten
                    </button>
                  </form>
                )}

                {selectedTicket.status === "NEEDS_CHANGES" && ticketDetail && (
                  <div className="notice">
                    <h4>W-04 Proof Status</h4>
                    <p>Nachbesserung erforderlich. Letzte QA Kommentare:</p>
                    <ul>
                      {ticketDetail.proofs.map((proof) => (
                        <li key={proof.id}>
                          {proof.qa_status} - {proof.qa_comment || "-"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </article>
        </section>
      )}

      {view === "qa" && userRole === "QA" && (
        <section className="grid-two">
          <article className="card">
            <h3>Q-01 QA Queue</h3>
            <label>
              Flag-Filter
              <select
                value={qaFlagFilter}
                onChange={(e) => {
                  setQaFlagFilter(e.target.value as "all" | "geo_fail" | "time_fail" | "exif_missing");
                  setReloadToken((v) => v + 1);
                }}
              >
                <option value="all">Alle</option>
                <option value="geo_fail">geo_fail</option>
                <option value="time_fail">time_fail</option>
                <option value="exif_missing">exif_missing</option>
              </select>
            </label>
            <ul className="list">
              {qaQueueEntries.map((entry) => (
                <li
                  key={entry.proof_id}
                  onClick={() => setSelectedTicketId(entry.ticket_id)}
                  className={entry.ticket_id === selectedTicketId ? "active" : ""}
                >
                  <strong>{entry.ticket_title}</strong> | {entry.category} | {formatDate(entry.submitted_at)}
                  <br />
                  Proof: {entry.proof_id} | Worker: {entry.submitted_by_user_id}
                </li>
              ))}
            </ul>
            {qaQueueEntries.length === 0 && <p>Keine Proofs in der Queue.</p>}
          </article>
          <article className="card">
            <h3>Q-02 QA Review</h3>
            {!ticketDetail && <p>Ticket in der Queue auswaehlen.</p>}
            {ticketDetail && (
              <>
                {ticketDetail.proofs.length === 0 && <p>Keine Proofs.</p>}
                {ticketDetail.proofs.map((proof) => (
                  <div className="proof-card" key={proof.id}>
                    <p>
                      <strong>Proof:</strong> {proof.id}
                    </p>
                    <p>
                      <strong>Worker:</strong> {proof.submitted_by_user_id}
                    </p>
                    <p>
                      <strong>Validation:</strong> {JSON.stringify(proof.validation_flags_json)}
                    </p>
                    <p>
                      <strong>Checkliste:</strong> {JSON.stringify(proof.checklist_answers_json)}
                    </p>
                    <p>
                      <strong>Captured:</strong> {formatDate(proof.captured_at)}
                    </p>
                    <p>
                      <strong>GPS:</strong> {proof.gps_lat ?? "-"}, {proof.gps_lng ?? "-"}
                    </p>
                    <div className="proof-media-grid">
                      {(proof.files ?? []).map((file) => (
                        <figure key={file.id} className="proof-image">
                          {proofImageUrls[file.id] ? (
                            <img src={proofImageUrls[file.id]} alt={`Proof Datei ${file.file_key}`} className="proof-thumb" />
                          ) : (
                            <div className="proof-thumb loading">Bild wird geladen...</div>
                          )}
                          <figcaption>{file.file_key}</figcaption>
                        </figure>
                      ))}
                      {(proof.files ?? []).length === 0 && <p>Keine Fotos vorhanden.</p>}
                    </div>
                    {buildProofMapUrl(proof.gps_lat, proof.gps_lng) ? (
                      <div className="map-block">
                        <p className="map-caption">Map Preview</p>
                        <img
                          src={buildProofMapUrl(proof.gps_lat, proof.gps_lng)!}
                          alt="Proof-Position auf Karte"
                          className="map-image"
                        />
                      </div>
                    ) : (
                      <p>Map Preview: GPS fehlt.</p>
                    )}
                    <div className="button-row">
                      <button onClick={() => onQaDecision("APPROVE", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Approve
                      </button>
                      <button
                        onClick={() => onQaDecision("REQUEST_CHANGES", proof.id)}
                        disabled={proof.qa_status !== "PENDING"}
                      >
                        Request Changes
                      </button>
                      <button onClick={() => onQaDecision("REJECT", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Reject
                      </button>
                      <button onClick={() => onQaDecision("ESCALATE", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Escalate
                      </button>
                    </div>
                  </div>
                ))}
                <label>
                  QA Kommentar
                  <textarea value={qaComment} onChange={(e) => setQaComment(e.target.value)} />
                </label>
              </>
            )}
          </article>
        </section>
      )}

      {view === "admin" && userRole === "ADMIN" && (
        <section className="grid-two">
          <article className="card">
            <h3>Admin - KPI Snapshot</h3>
            {!adminMetrics && <p>Keine Metriken geladen.</p>}
            {adminMetrics && (
              <>
                <p>
                  <strong>Erzeugt:</strong> {formatDate(adminMetrics.generated_at)}
                </p>
                <p>
                  <strong>Tickets:</strong> {adminMetrics.totals.tickets}
                </p>
                <p>
                  <strong>Proofs:</strong> {adminMetrics.totals.proofs}
                </p>
                <p>
                  <strong>QA entschieden:</strong> {adminMetrics.totals.qa_decided_proofs}
                </p>
                <p>
                  <strong>Median Ticket-&gt;Accept:</strong>{" "}
                  {formatSeconds(adminMetrics.kpis.median_ticket_to_accepted_seconds)}
                </p>
                <p>
                  <strong>First-Pass-Quote:</strong> {formatPercent(adminMetrics.kpis.first_pass_proof_complete_rate)}
                </p>
                <p>
                  <strong>QA Durchlaufzeit:</strong> {formatSeconds(adminMetrics.kpis.avg_qa_cycle_seconds)}
                </p>
                <p>
                  <strong>Nachforderungsrate:</strong> {formatPercent(adminMetrics.kpis.change_request_rate)}
                </p>
              </>
            )}
          </article>

          <article className="card">
            <h3>Admin - User Rollen</h3>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Rolle</th>
                  <th>Verified</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.display_name ?? "-"}</td>
                    <td>
                      <select
                        value={user.role}
                        onChange={(e) => {
                          const nextRole = e.target.value as Role;
                          setAdminUsers((current) =>
                            current.map((row) => (row.id === user.id ? { ...row, role: nextRole } : row))
                          );
                        }}
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="REQUESTER">REQUESTER</option>
                        <option value="WORKER">WORKER</option>
                        <option value="QA">QA</option>
                      </select>
                    </td>
                    <td>{user.is_verified ? "ja" : "nein"}</td>
                    <td>
                      <button onClick={() => onUpdateUserRole(user.id, user.role)}>Speichern</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="card full-width">
            <h3>Admin - Templates</h3>
            <form onSubmit={onSaveTemplate} className="form-grid">
              <label>
                Name
                <input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                Kategorie
                <input
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, category: e.target.value }))}
                  required
                />
              </label>
              <label>
                Task-Klasse
                <select
                  value={templateForm.task_class}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, task_class: Number(e.target.value) }))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label>
                Geofence Default (m)
                <input
                  type="number"
                  value={templateForm.default_geofence_radius_m}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, default_geofence_radius_m: e.target.value }))}
                  required
                />
              </label>
              <label>
                Checklist JSON
                <textarea
                  value={templateForm.checklist_json}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, checklist_json: e.target.value }))}
                />
              </label>
              <label>
                Proof Policy JSON
                <textarea
                  value={templateForm.proof_policy_json}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, proof_policy_json: e.target.value }))}
                />
              </label>
              <div className="button-row">
                <button type="submit">{selectedTemplateId ? "Template updaten" : "Template erstellen"}</button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId("");
                    setTemplateForm(defaultTemplateForm);
                  }}
                >
                  Formular leeren
                </button>
              </div>
            </form>

            <h4>Vorhandene Templates</h4>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kategorie</th>
                  <th>Klasse</th>
                  <th>Geofence</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>{template.category}</td>
                    <td>{template.task_class}</td>
                    <td>{template.default_geofence_radius_m}</td>
                    <td>
                      <div className="button-row">
                        <button type="button" onClick={() => onSelectTemplateForEdit(template)}>
                          Bearbeiten
                        </button>
                        <button type="button" onClick={() => onDeleteTemplate(template.id)}>
                          Loeschen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}
    </main>
  );
}

export default App;

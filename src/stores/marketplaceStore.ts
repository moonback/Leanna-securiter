/**
 * Store Marketplace — gestion côté client du catalogue d'agents et skills.
 *
 * Expose un pattern subscribe/useSyncExternalStore pour l'intégration React.
 * Toutes les opérations réseau passent par /api/marketplace/*.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Types miroirs (subset client des types serveur)
// ═══════════════════════════════════════════════════════════════════════════════

export type MarketplacePackageType = "agent" | "skill" | "bundle";

export type MarketplaceCategory =
  | "code" | "devops" | "web" | "data" | "writing"
  | "security" | "productivity" | "ai" | "other";

export type SecurityTrustLevel = "verified" | "community" | "unreviewed" | "flagged";

export interface MarketplaceReview {
  id: string;
  author: string;
  rating: number;
  comment: string;
  createdAt: string;
  helpful: number;
}

export interface MarketplaceStats {
  downloads: number;
  installs: number;
  rating: number;
  reviewCount: number;
  weeklyDownloads: number;
}

export interface SecurityReport {
  trustLevel: SecurityTrustLevel;
  analyzedAt: string;
  score: number;
  warnings: string[];
  flags: string[];
  summary: string;
}

export interface MarketplacePackage {
  id: string;
  name: string;
  description: string;
  readme?: string;
  type: MarketplacePackageType;
  category: MarketplaceCategory;
  tags: string[];
  version: string;
  versions: string[];
  author: string;
  authorAvatar?: string;
  license: string;
  repositoryUrl?: string;
  avatar: string;
  color: string;
  agent?: {
    name: string;
    role: string;
    description: string;
    capabilities: string[];
    triggerKeywords?: string[];
    [key: string]: any;
  };
  skills?: Array<{
    name: string;
    description: string;
    parameters: any[];
    [key: string]: any;
  }>;
  security: SecurityReport;
  stats: MarketplaceStats;
  reviews: MarketplaceReview[];
  publishedAt: string;
  updatedAt: string;
  featured: boolean;
  verified: boolean;
  /** Enrichissement côté serveur — indique si ce paquet est installé localement */
  _installed?: boolean;
}

export interface MarketplaceStoreState {
  packages: MarketplacePackage[];
  featured: MarketplacePackage[];
  installed: MarketplacePackage[];
  total: number;
  page: number;
  totalPages: number;
  stats: {
    total: number;
    agents: number;
    skills: number;
    bundles: number;
    verified: number;
    totalInstalls: number;
    installed: number;
  } | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  activeType: MarketplacePackageType | "";
  activeCategory: MarketplaceCategory | "";
  activeSort: "popular" | "recent" | "rating" | "installs";
  selectedPackage: MarketplacePackage | null;
  installLoading: Record<string, boolean>;
  installResults: Record<string, { success: boolean; message?: string; error?: string }>;
}

export interface PublishDraft {
  name: string;
  description: string;
  readme: string;
  type: MarketplacePackageType;
  category: MarketplaceCategory;
  tags: string[];
  version: string;
  author: string;
  license: string;
  repositoryUrl: string;
  avatar: string;
  color: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// État interne
// ═══════════════════════════════════════════════════════════════════════════════

type Listener = () => void;

let state: MarketplaceStoreState = {
  packages: [],
  featured: [],
  installed: [],
  total: 0,
  page: 1,
  totalPages: 1,
  stats: null,
  loading: false,
  error: null,
  searchQuery: "",
  activeType: "",
  activeCategory: "",
  activeSort: "popular",
  selectedPackage: null,
  installLoading: {},
  installResults: {},
};

let listeners: Listener[] = [];

function notify() {
  for (const fn of listeners) fn();
}

function setState(partial: Partial<MarketplaceStoreState>) {
  state = { ...state, ...partial };
  notify();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers API
// ═══════════════════════════════════════════════════════════════════════════════

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data as T;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Actions publiques
// ═══════════════════════════════════════════════════════════════════════════════

/** Charge le catalogue avec les filtres actifs */
export async function searchMarketplace(overrides?: Partial<{
  query: string;
  type: MarketplacePackageType | "";
  category: MarketplaceCategory | "";
  sort: "popular" | "recent" | "rating" | "installs";
  page: number;
}>): Promise<void> {
  const q = overrides?.query ?? state.searchQuery;
  const type = overrides?.type ?? state.activeType;
  const category = overrides?.category ?? state.activeCategory;
  const sort = overrides?.sort ?? state.activeSort;
  const page = overrides?.page ?? state.page;

  // Mettre à jour les filtres actifs
  setState({
    searchQuery: q,
    activeType: type as MarketplacePackageType | "",
    activeCategory: category as MarketplaceCategory | "",
    activeSort: sort,
    page,
    loading: true,
    error: null,
  });

  try {
    const params = new URLSearchParams();
    if (q) params.set("query", q);
    if (type) params.set("type", type);
    if (category) params.set("category", category);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", "20");

    const data = await apiFetch<any>(`/api/marketplace/search?${params.toString()}`);
    setState({
      packages: data.packages ?? [],
      total: data.total ?? 0,
      page: data.page ?? 1,
      totalPages: data.totalPages ?? 1,
      loading: false,
    });
  } catch (e: any) {
    setState({ loading: false, error: e.message, packages: [] });
  }
}

/** Charge les paquets mis en avant */
export async function loadFeatured(): Promise<void> {
  try {
    const data = await apiFetch<any>("/api/marketplace/featured");
    setState({ featured: data.packages ?? [] });
  } catch {
    // silencieux
  }
}

/** Charge les paquets installés */
export async function loadInstalled(): Promise<void> {
  try {
    const data = await apiFetch<any>("/api/marketplace/installed");
    setState({ installed: data.packages ?? [] });
  } catch {
    // silencieux
  }
}

/** Charge les statistiques globales */
export async function loadStats(): Promise<void> {
  try {
    const data = await apiFetch<any>("/api/marketplace/stats");
    setState({ stats: data.stats ?? null });
  } catch {
    // silencieux
  }
}

/** Initialise toutes les données du Marketplace */
export async function initMarketplaceStore(): Promise<void> {
  await Promise.all([
    searchMarketplace(),
    loadFeatured(),
    loadInstalled(),
    loadStats(),
  ]);
}

/** Récupère les détails complets d'un paquet */
export async function selectPackage(id: string): Promise<void> {
  setState({ selectedPackage: null });
  try {
    const data = await apiFetch<any>(`/api/marketplace/package/${id}`);
    setState({ selectedPackage: data.package ?? null });
  } catch (e: any) {
    setState({ error: e.message });
  }
}

/** Ferme la vue détail */
export function clearSelectedPackage(): void {
  setState({ selectedPackage: null });
}

/** Installe un paquet en un clic */
export async function installPackage(packageId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  setState({ installLoading: { ...state.installLoading, [packageId]: true } });
  try {
    const data = await apiFetch<any>("/api/marketplace/install", {
      method: "POST",
      body: JSON.stringify({ packageId }),
    });
    const result = { success: true, message: data.message };
    setState({
      installLoading: { ...state.installLoading, [packageId]: false },
      installResults: { ...state.installResults, [packageId]: result },
    });
    // Recharger les installés
    await loadInstalled();
    // Mettre à jour le paquet dans la liste
    setState({
      packages: state.packages.map((p) =>
        p.id === packageId ? { ...p, _installed: true } : p
      ),
      featured: state.featured.map((p) =>
        p.id === packageId ? { ...p, _installed: true } : p
      ),
    });
    if (state.selectedPackage?.id === packageId) {
      setState({ selectedPackage: { ...state.selectedPackage, _installed: true } });
    }
    return result;
  } catch (e: any) {
    const result = { success: false, error: e.message };
    setState({
      installLoading: { ...state.installLoading, [packageId]: false },
      installResults: { ...state.installResults, [packageId]: result },
    });
    return result;
  }
}

/** Désinstalle un paquet */
export async function uninstallPackage(packageId: string): Promise<{ success: boolean; error?: string }> {
  setState({ installLoading: { ...state.installLoading, [packageId]: true } });
  try {
    await apiFetch<any>("/api/marketplace/uninstall", {
      method: "POST",
      body: JSON.stringify({ packageId }),
    });
    setState({
      installLoading: { ...state.installLoading, [packageId]: false },
      installed: state.installed.filter((p) => p.id !== packageId),
      packages: state.packages.map((p) =>
        p.id === packageId ? { ...p, _installed: false } : p
      ),
    });
    if (state.selectedPackage?.id === packageId) {
      setState({ selectedPackage: { ...state.selectedPackage, _installed: false } });
    }
    return { success: true };
  } catch (e: any) {
    setState({ installLoading: { ...state.installLoading, [packageId]: false } });
    return { success: false, error: e.message };
  }
}

/** Soumet une note/avis sur un paquet */
export async function ratePackage(packageId: string, rating: number, comment: string, author: string): Promise<boolean> {
  try {
    await apiFetch<any>("/api/marketplace/rate", {
      method: "POST",
      body: JSON.stringify({ packageId, rating, comment, author }),
    });
    // Recharger le paquet sélectionné si c'est lui
    if (state.selectedPackage?.id === packageId) {
      await selectPackage(packageId);
    }
    return true;
  } catch {
    return false;
  }
}

/** Publie un paquet dans le registre local */
export async function publishPackage(draft: any): Promise<{
  success: boolean;
  package?: MarketplacePackage;
  securityReport?: any;
  error?: string;
}> {
  try {
    const data = await apiFetch<any>("/api/marketplace/publish", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    if (data.success) {
      await searchMarketplace();
    }
    return data;
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Valide la sécurité d'un brouillon sans le publier */
export async function validateSecurity(draft: any): Promise<{ success: boolean; securityReport?: any; error?: string }> {
  try {
    const data = await apiFetch<any>("/api/marketplace/validate-security", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    return data;
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/** Télécharge un paquet en JSON */
export function downloadPackage(id: string): void {
  window.open(`/api/marketplace/export/${id}`, "_blank");
}

// ─── Filtres rapides ─────────────────────────────────────────────────────────

export function setSearchQuery(query: string): void {
  searchMarketplace({ query, page: 1 });
}

export function setActiveType(type: MarketplacePackageType | ""): void {
  searchMarketplace({ type, page: 1 });
}

export function setActiveCategory(category: MarketplaceCategory | ""): void {
  searchMarketplace({ category, page: 1 });
}

export function setActiveSort(sort: "popular" | "recent" | "rating" | "installs"): void {
  searchMarketplace({ sort, page: 1 });
}

export function setPage(page: number): void {
  searchMarketplace({ page });
}

// ─── useSyncExternalStore ────────────────────────────────────────────────────

export function getMarketplaceState(): MarketplaceStoreState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

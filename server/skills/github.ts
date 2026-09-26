import { Skill } from "./base.js";
import { guardUntrustedContent, guardUntrustedFields } from "../utils/promptInjectionGuard.js";

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "Leanna",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch(endpoint: string): Promise<any> {
  console.log(`[GitHub] GET ${endpoint}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GITHUB_API}${endpoint}`, {
      headers: getHeaders(),
      signal: controller.signal,
    });
    console.log(`[GitHub] GET ${endpoint} → ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const errMsg = body.message || `GitHub API ${res.status}: ${res.statusText}`;
      console.error(`[GitHub] Erreur: ${errMsg}`);
      return { error: errMsg };
    }
    return await res.json();
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.error(`[GitHub] Timeout sur GET ${endpoint}`);
      return { error: "Timeout: GitHub API n'a pas répondu." };
    }
    console.error(`[GitHub] Erreur réseau GET ${endpoint}:`, e.message);
    return { error: e.message || "Erreur réseau GitHub" };
  } finally {
    clearTimeout(timeout);
  }
}

async function githubPost(endpoint: string, body: any): Promise<any> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    console.warn(`[GitHub] POST ${endpoint} — GITHUB_TOKEN manquant, opération refusée.`);
    return { error: "GITHUB_TOKEN non configuré. Ajoutez-le dans les paramètres." };
  }

  console.log(`[GitHub] POST ${endpoint}`, JSON.stringify(body).slice(0, 200));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GITHUB_API}${endpoint}`, {
      method: "POST",
      headers: { ...getHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    console.log(`[GitHub] POST ${endpoint} → ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const errMsg = data.message || `GitHub API ${res.status}: ${res.statusText}`;
      console.error(`[GitHub] Erreur POST: ${errMsg}`);
      return { error: errMsg };
    }
    return await res.json();
  } catch (e: any) {
    if (e.name === "AbortError") {
      console.error(`[GitHub] Timeout sur POST ${endpoint}`);
      return { error: "Timeout: GitHub API n'a pas répondu." };
    }
    console.error(`[GitHub] Erreur réseau POST ${endpoint}:`, e.message);
    return { error: e.message || "Erreur réseau GitHub" };
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(str: string, max = 3000): string {
  return str.length > max ? str.slice(0, max) + "... [tronqué]" : str;
}

export const githubSkill: Skill = {
  name: "github",
  // Accès réseau sortant vers l'API GitHub ; certains outils écrivent aussi
  // (issues distantes, ingestion dans la base de connaissances).
  permissions: ["network"],
  toolPermissions: {
    create_github_issue: ["network", "write"],
  },
  declarations: [
    {
      name: "get_github_user",
      description: "Obtenir les informations publiques d'un utilisateur GitHub.",
      parameters: {
        type: "OBJECT",
        properties: {
          username: { type: "STRING", description: "Le nom d'utilisateur GitHub" },
        },
        required: ["username"],
      },
    },
    {
      name: "get_github_repo",
      description: "Obtenir les informations d'un dépôt GitHub (stars, forks, description, langage).",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "list_github_repos",
      description: "Lister les dépôts d'un utilisateur ou de l'utilisateur authentifié.",
      parameters: {
        type: "OBJECT",
        properties: {
          username: { type: "STRING", description: "Le nom d'utilisateur (optionnel — si vide, liste les repos de l'utilisateur authentifié)" },
          sort: { type: "STRING", description: "Tri: created, updated, pushed, full_name (défaut: updated)" },
          limit: { type: "NUMBER", description: "Nombre max de résultats (défaut: 10, max: 30)" },
        },
      },
    },
    {
      name: "list_github_issues",
      description: "Lister les issues d'un dépôt GitHub (ouvertes par défaut).",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
          state: { type: "STRING", description: "Filtre: open, closed, all (défaut: open)" },
          limit: { type: "NUMBER", description: "Nombre max de résultats (défaut: 10, max: 30)" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "create_github_issue",
      description: "Créer une issue sur un dépôt GitHub (nécessite GITHUB_TOKEN).",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
          title: { type: "STRING", description: "Le titre de l'issue" },
          body: { type: "STRING", description: "Le contenu de l'issue (Markdown)" },
          labels: { type: "ARRAY", items: { type: "STRING" }, description: "Labels à appliquer (optionnel)" },
        },
        required: ["owner", "repo", "title"],
      },
    },
    {
      name: "list_github_pull_requests",
      description: "Lister les pull requests d'un dépôt GitHub.",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
          state: { type: "STRING", description: "Filtre: open, closed, all (défaut: open)" },
          limit: { type: "NUMBER", description: "Nombre max de résultats (défaut: 10, max: 30)" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "search_github_repos",
      description: "Rechercher des dépôts GitHub par mot-clé.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Termes de recherche (ex: 'react framework stars:>1000')" },
          limit: { type: "NUMBER", description: "Nombre max de résultats (défaut: 10, max: 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_github_file_content",
      description: "Lire le contenu d'un fichier dans un dépôt GitHub.",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
          path: { type: "STRING", description: "Chemin du fichier (ex: src/index.ts)" },
          ref: { type: "STRING", description: "Branche ou commit (défaut: branche par défaut)" },
        },
        required: ["owner", "repo", "path"],
      },
    },
    {
      name: "get_github_notifications",
      description: "Obtenir les notifications GitHub de l'utilisateur authentifié (nécessite GITHUB_TOKEN).",
      parameters: {
        type: "OBJECT",
        properties: {
          limit: { type: "NUMBER", description: "Nombre max (défaut: 10, max: 30)" },
        },
      },
    },
    {
      name: "list_github_repo_files",
      description: "Lister tous les fichiers d'un dépôt GitHub avec leurs métadonnées.",
      parameters: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING", description: "Le propriétaire du dépôt" },
          repo: { type: "STRING", description: "Le nom du dépôt" },
          ref: { type: "STRING", description: "Branche ou commit (défaut: branche par défaut)" },
          file_extensions: { 
            type: "ARRAY", 
            items: { type: "STRING" }, 
            description: "Filtrer par extensions de fichiers (optionnel, ex: ['.ts', '.js'])" 
          },
          max_files: { type: "NUMBER", description: "Nombre max de fichiers à retourner (défaut: 100, max: 500)" },
        },
        required: ["owner", "repo"],
      },
    },
    // NOTE: L'outil "ingest_github_repository" a été retiré volontairement.
    // L'agent ne doit plus pouvoir voir ni intervenir sur les notebooks
    // (ingestion de sources incluse). L'ingestion de dépôts vers un notebook
    // reste possible uniquement via l'UI / l'API /api/notebooks côté utilisateur.
  ],

  handleToolCall: async (name, args: Record<string, any>) => {
    console.log(`[GitHub] Appel outil: ${name}`, JSON.stringify(args).slice(0, 300));
    const startTime = Date.now();
    try {
      switch (name) {
        // ─── Get User ───────────────────────────────────────────────────
        case "get_github_user": {
          const username = args.username?.trim();
          if (!username && !process.env.GITHUB_TOKEN?.trim()) {
            return { error: "GITHUB_TOKEN non configuré. Spécifiez un nom d'utilisateur." };
          }
          const endpoint = username ? `/users/${encodeURIComponent(username)}` : `/user`;
          console.log(`[GitHub] Récupération profil utilisateur: ${username || '(authentifié)'}`);
          const data = await githubFetch(endpoint);
          if (data.error) { console.warn(`[GitHub] get_github_user échec: ${data.error}`); return data; }
          console.log(`[GitHub] get_github_user OK: ${data.login} (${data.public_repos} repos, ${data.followers} followers) [${Date.now() - startTime}ms]`);
          // Champs texte libre contrôlables par l'utilisateur GitHub distant :
          // neutraliser toute instruction injectée avant de les renvoyer au modèle.
          return guardUntrustedFields(
            {
              login: data.login,
              name: data.name,
              bio: data.bio,
              company: data.company,
              location: data.location,
              blog: data.blog,
              followers: data.followers,
              following: data.following,
              public_repos: data.public_repos,
              total_private_repos: data.total_private_repos,
              owned_private_repos: data.owned_private_repos,
              created_at: data.created_at,
              avatar_url: data.avatar_url,
            },
            ["name", "bio", "company", "location", "blog"],
            "github",
          );
        }

        // ─── Get Repo ───────────────────────────────────────────────────
        case "get_github_repo": {
          const { owner, repo } = args;
          if (!owner || !repo) return { error: "owner et repo sont requis." };
          console.log(`[GitHub] Récupération dépôt: ${owner}/${repo}`);
          const data = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
          if (data.error) { console.warn(`[GitHub] get_github_repo échec: ${data.error}`); return data; }
          console.log(`[GitHub] get_github_repo OK: ${data.full_name} ⭐${data.stargazers_count} [${Date.now() - startTime}ms]`);
          return guardUntrustedFields(
            {
              full_name: data.full_name,
              name: data.name,
              owner: data.owner?.login || owner,
              repo: data.name || repo,
              description: data.description,
              language: data.language,
              stars: data.stargazers_count,
              forks: data.forks_count,
              open_issues: data.open_issues_count,
              default_branch: data.default_branch,
              private: !!data.private,
              topics: data.topics || [],
              license: data.license?.spdx_id,
              updated_at: data.updated_at,
              html_url: data.html_url,
            },
            ["description", "topics"],
            "github",
          );
        }

        // ─── List Repos ─────────────────────────────────────────────────
        case "list_github_repos": {
          const username = args.username?.trim();
          const sort = args.sort || "updated";
          const limit = Math.min(args.limit || 50, 100);
          const visibility = args.visibility;
          console.log(`[GitHub] Liste repos: user=${username || '(authenticated)'}, sort=${sort}, limit=${limit}`);
          
          // Si pas de username et pas de token, on ne peut pas lister les repos privés
          if (!username && !process.env.GITHUB_TOKEN?.trim()) {
            console.warn(`[GitHub] list_github_repos: pas de username ni de GITHUB_TOKEN`);
            return { error: "GITHUB_TOKEN non configuré. Spécifiez un username ou ajoutez votre token GitHub." };
          }
          
          let endpoint = username
            ? `/users/${encodeURIComponent(username)}/repos?sort=${sort}&per_page=${limit}`
            : `/user/repos?sort=${sort}&per_page=${limit}&affiliation=owner,collaborator,organization_member`;

          if (!username && visibility && ['all', 'public', 'private'].includes(visibility)) {
            endpoint += `&visibility=${visibility}`;
          }

          const data = await githubFetch(endpoint);
          if (data.error) { console.warn(`[GitHub] list_github_repos échec: ${data.error}`); return data; }
          if (!Array.isArray(data)) return { error: "Réponse inattendue de GitHub." };
          console.log(`[GitHub] list_github_repos OK: ${data.length} repos retournés [${Date.now() - startTime}ms]`);
          return {
            repos: data.map((r: any) => guardUntrustedFields(
              {
                full_name: r.full_name,
                name: r.name,
                owner: r.owner?.login || r.full_name.split('/')[0],
                repo: r.name || r.full_name.split('/')[1],
                description: r.description,
                language: r.language,
                stars: r.stargazers_count,
                forks: r.forks_count,
                default_branch: r.default_branch,
                topics: r.topics || [],
                updated_at: r.updated_at,
                private: !!r.private,
                html_url: r.html_url,
              },
              ["description", "topics"],
              "github",
            )),
          };
        }

        // ─── List Issues ────────────────────────────────────────────────
        case "list_github_issues": {
          const { owner, repo } = args;
          if (!owner || !repo) return { error: "owner et repo sont requis." };
          const state = args.state || "open";
          const limit = Math.min(args.limit || 10, 30);
          console.log(`[GitHub] Liste issues: ${owner}/${repo} (state=${state}, limit=${limit})`);
          const data = await githubFetch(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${state}&per_page=${limit}`
          );
          if (data.error) { console.warn(`[GitHub] list_github_issues échec: ${data.error}`); return data; }
          if (!Array.isArray(data)) return { error: "Réponse inattendue." };
          const issues = data.filter((i: any) => !i.pull_request);
          console.log(`[GitHub] list_github_issues OK: ${issues.length} issues retournées [${Date.now() - startTime}ms]`);
          return {
            issues: issues.map((i: any) => guardUntrustedFields(
                {
                  number: i.number,
                  title: i.title,
                  state: i.state,
                  author: i.user?.login,
                  labels: (i.labels?.map((l: any) => l.name) ?? []),
                  created_at: i.created_at,
                  comments: i.comments,
                  html_url: i.html_url,
                },
                ["title", "labels"],
                "github",
              )),
          };
        }

        // ─── Create Issue ───────────────────────────────────────────────
        case "create_github_issue": {
          const { owner, repo, title, body, labels } = args;
          if (!owner || !repo || !title) return { error: "owner, repo et title sont requis." };
          console.log(`[GitHub] Création issue: ${owner}/${repo} — "${title}"`);
          const payload: any = { title };
          if (body) payload.body = body;
          if (labels?.length) payload.labels = labels;
          const data = await githubPost(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
            payload
          );
          if (data.error) { console.warn(`[GitHub] create_github_issue échec: ${data.error}`); return data; }
          console.log(`[GitHub] create_github_issue OK: #${data.number} créée → ${data.html_url} [${Date.now() - startTime}ms]`);
          return {
            status: "success",
            number: data.number,
            title: data.title,
            html_url: data.html_url,
          };
        }

        // ─── List Pull Requests ─────────────────────────────────────────
        case "list_github_pull_requests": {
          const { owner, repo } = args;
          if (!owner || !repo) return { error: "owner et repo sont requis." };
          const state = args.state || "open";
          const limit = Math.min(args.limit || 10, 30);
          console.log(`[GitHub] Liste PRs: ${owner}/${repo} (state=${state}, limit=${limit})`);
          const data = await githubFetch(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&per_page=${limit}`
          );
          if (data.error) { console.warn(`[GitHub] list_github_pull_requests échec: ${data.error}`); return data; }
          if (!Array.isArray(data)) return { error: "Réponse inattendue." };
          console.log(`[GitHub] list_github_pull_requests OK: ${data.length} PRs retournées [${Date.now() - startTime}ms]`);
          return {
            pull_requests: data.map((pr: any) => guardUntrustedFields(
              {
                number: pr.number,
                title: pr.title,
                state: pr.state,
                author: pr.user?.login,
                head: pr.head?.ref,
                base: pr.base?.ref,
                created_at: pr.created_at,
                draft: pr.draft,
                html_url: pr.html_url,
              },
              ["title"],
              "github",
            )),
          };
        }

        // ─── Search Repos ───────────────────────────────────────────────
        case "search_github_repos": {
          const query = args.query?.trim();
          if (!query) return { error: "Le terme de recherche est requis." };
          const limit = Math.min(args.limit || 10, 20);
          console.log(`[GitHub] Recherche repos: "${query}" (limit=${limit})`);
          const data = await githubFetch(
            `/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars&order=desc`
          );
          if (data.error) { console.warn(`[GitHub] search_github_repos échec: ${data.error}`); return data; }
          console.log(`[GitHub] search_github_repos OK: ${data.total_count} résultats totaux, ${(data.items || []).length} retournés [${Date.now() - startTime}ms]`);
          return {
            total_count: data.total_count,
            repos: (data.items || []).map((r: any) => guardUntrustedFields(
              {
                full_name: r.full_name,
                description: r.description,
                language: r.language,
                stars: r.stargazers_count,
                forks: r.forks_count,
                topics: r.topics?.slice(0, 5) ?? [],
                html_url: r.html_url,
              },
              ["description", "topics"],
              "github",
            )),
          };
        }

        // ─── Get File Content ───────────────────────────────────────────
        case "get_github_file_content": {
          const { owner, repo, path, ref } = args;
          if (!owner || !repo || !path) return { error: "owner, repo et path sont requis." };
          console.log(`[GitHub] Lecture fichier: ${owner}/${repo}/${path}${ref ? ` @${ref}` : ''}`);
          let endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
          if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
          const data = await githubFetch(endpoint);
          if (data.error) { console.warn(`[GitHub] get_github_file_content échec: ${data.error}`); return data; }
          if (data.type === "dir") {
            console.log(`[GitHub] get_github_file_content OK: répertoire avec ${(data as any[]).length} entrées [${Date.now() - startTime}ms]`);
            return {
              type: "directory",
              entries: (data as any[]).map((e: any) => ({ name: e.name, type: e.type, path: e.path })),
            };
          }
          if (data.encoding === "base64" && data.content) {
            const decoded = Buffer.from(data.content, "base64").toString("utf-8");
            console.log(`[GitHub] get_github_file_content OK: fichier ${data.path} (${data.size} bytes) [${Date.now() - startTime}ms]`);
            // Contenu de dépôt distant = donnée externe non fiable : neutraliser
            // toute instruction injectée avant de le renvoyer au modèle.
            const guarded = guardUntrustedContent(truncate(decoded, 6000), "github");
            return {
              type: "file",
              path: data.path,
              size: data.size,
              content: guarded.text,
              promptInjection: guarded.promptInjection,
            };
          }
          console.log(`[GitHub] get_github_file_content OK: fichier ${data.path} (téléchargement externe) [${Date.now() - startTime}ms]`);
          return { type: "file", path: data.path, size: data.size, download_url: data.download_url };
        }

        // ─── Get Notifications ──────────────────────────────────────────
        case "get_github_notifications": {
          const token = process.env.GITHUB_TOKEN?.trim();
          if (!token) {
            console.warn(`[GitHub] get_github_notifications — GITHUB_TOKEN manquant.`);
            return { error: "GITHUB_TOKEN non configuré." };
          }
          const limit = Math.min(args.limit || 10, 30);
          console.log(`[GitHub] Récupération notifications (limit=${limit})`);
          const data = await githubFetch(`/notifications?per_page=${limit}`);
          if (data.error) { console.warn(`[GitHub] get_github_notifications échec: ${data.error}`); return data; }
          if (!Array.isArray(data)) return { error: "Réponse inattendue." };
          console.log(`[GitHub] get_github_notifications OK: ${data.length} notifications [${Date.now() - startTime}ms]`);
          return {
            notifications: data.map((n: any) => guardUntrustedFields(
              {
                id: n.id,
                reason: n.reason,
                unread: n.unread,
                title: n.subject?.title,
                type: n.subject?.type,
                repo: n.repository?.full_name,
                updated_at: n.updated_at,
              },
              ["title"],
              "github",
            )),
          };
        }

        // ─── List Repository Files ───────────────────────────────────────────
        case "list_github_repo_files": {
          const { owner, repo, ref, file_extensions, max_files } = args;
          if (!owner || !repo) return { error: "owner et repo sont requis." };
          
          const limit = Math.min(max_files || 100, 500);
          const extensions = file_extensions || [];
          const targetRef = ref || ''; // Vide = branche par défaut
          
          console.log(`[GitHub] Liste fichiers: ${owner}/${repo}${targetRef ? `@${targetRef}` : ''} (max: ${limit}, extensions: ${extensions.length > 0 ? extensions.join(',') : 'toutes'})`);

          // 1. D'abord obtenir les infos du repo pour avoir la branche par défaut
          let branchToUse = targetRef;
          if (!branchToUse) {
            const repoData = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
            if (repoData.error) { console.warn(`[GitHub] list_github_repo_files échec repo: ${repoData.error}`); return repoData; }
            branchToUse = repoData.default_branch;
          }

          // 2. Obtenir l'arbre complet du dépôt
          const treeEndpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branchToUse)}?recursive=1`;
          const treeData = await githubFetch(treeEndpoint);
          if (treeData.error) { console.warn(`[GitHub] list_github_repo_files échec arbre: ${treeData.error}`); return treeData; }
          
          if (!treeData.tree || !Array.isArray(treeData.tree)) {
            return { error: "Structure de l'arbre inattendue." };
          }

          // 3. Filtrer et limiter les résultats
          const files = treeData.tree
            .filter((item: any) => item.type === 'blob') // Uniquement les fichiers
            .filter((item: any) => {
              if (extensions.length === 0) return true;
              const ext = item.path.split('.').pop()?.toLowerCase();
              return extensions.includes(`.${ext}`) || extensions.includes(ext || '');
            })
            .slice(0, limit);

          console.log(`[GitHub] list_github_repo_files OK: ${files.length} fichiers retournés [${Date.now() - startTime}ms]`);
          return {
            repository: {
              owner,
              repo,
              branch: branchToUse,
              total_files: files.length,
              truncated: treeData.tree.filter((item: any) => item.type === 'blob').length > limit,
            },
            files: files.map((f: any) => ({
              path: f.path,
              mode: f.mode,
              type: f.type,
              size: f.size,
              sha: f.sha,
              url: f.url,
            })),
          };
        }

        // ─── Ingest GitHub Repository (RETIRÉ) ───────────────────────────────
        // L'agent n'a plus accès aux notebooks : l'ingestion de dépôts vers un
        // notebook n'est plus exposée comme outil. Voir l'UI / l'API /api/notebooks.

        default:
          console.warn(`[GitHub] Outil inconnu appelé: ${name}`);
          return { error: `Outil GitHub inconnu: ${name}` };
      }
    } catch (error: any) {
      console.error(`[GitHub] Exception non gérée dans ${name}:`, error.message || error);
      return { error: `Erreur GitHub: ${error.message || String(error)}` };
    }
  },
};

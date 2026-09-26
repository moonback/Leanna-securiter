/**
 * server/skills/securityAudit.ts
 * 
 * Ce fichier est conservé comme façade de rétrocompatibilité.
 * Toute l'implémentation est désormais modulaire dans server/skills/security/.
 */

export {
  securitySkill,
  securityAuditSkill,
} from "./security/index.js";
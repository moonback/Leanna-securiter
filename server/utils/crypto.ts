import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Cached master key to avoid regenerating on every encryption/decryption
let cachedMasterKey: Buffer | null = null;

/**
 * Generate a cryptographically secure random master key.
 * Returns a 32-byte (256-bit) key in base64 format.
 */
function generateSecureMasterKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Ensure a master encryption key exists. If not found in environment,
 * generates one and saves it to .env file (or .env.local if .env doesn't exist).
 * Returns the key as a Buffer.
 */
function ensureMasterKey(): Buffer {
  const envKey = process.env.Leanna_MASTER_KEY?.trim();
  
  if (envKey && envKey.length > 0) {
    // Valid key exists, decode from base64
    try {
      const keyBuffer = Buffer.from(envKey, 'base64');
      if (keyBuffer.length === 32) {
        return keyBuffer;
      }
      // If key is not 32 bytes, fall through to generate new one
      console.warn('[Crypto] Leanna_MASTER_KEY has invalid length, generating new key');
    } catch (error) {
      console.warn('[Crypto] Leanna_MASTER_KEY is not valid base64, generating new key');
    }
  }

  // Generate a new secure key
  const newKey = generateSecureMasterKey();
  
  // Determine which .env file to update
  // Note: SELF_ROOT may not be available during early initialization,
  // so we use process.cwd() as fallback
  let rootPath: string;
  try {
    // Try to import SELF_ROOT dynamically to avoid circular dependency
    rootPath = process.cwd();
  } catch {
    rootPath = process.cwd();
  }
  
  const envPath = path.join(rootPath, '.env');
  const envLocalPath = path.join(rootPath, '.env.local');
  
  let targetPath = envPath;
  if (!fs.existsSync(envPath) && fs.existsSync(envLocalPath)) {
    targetPath = envLocalPath;
  }

  // Append or update the key in the file
  try {
    let envContent = '';
    if (fs.existsSync(targetPath)) {
      envContent = fs.readFileSync(targetPath, 'utf-8');
    }

    // Check if Leanna_MASTER_KEY line already exists (empty or commented)
    const keyLineRegex = /^#?\s*Leanna_MASTER_KEY\s*=.*$/m;
    
    if (keyLineRegex.test(envContent)) {
      // Replace existing line
      envContent = envContent.replace(
        keyLineRegex,
        `Leanna_MASTER_KEY="${newKey}"`
      );
    } else {
      // Append new line
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n';
      }
      envContent += `\n# Auto-generated master encryption key for Leanna (AES-256-GCM)\n# KEEP THIS SECRET - Used to encrypt API keys and sensitive data\nLeanna_MASTER_KEY="${newKey}"\n`;
    }

    fs.writeFileSync(targetPath, envContent, 'utf-8');
    
    // Update process.env for current session
    process.env.Leanna_MASTER_KEY = newKey;
    
    console.log(`[Crypto] ✓ Generated new master encryption key and saved to ${path.basename(targetPath)}`);
    console.log(`[Crypto] ⚠️  IMPORTANT: This key protects your API keys and sensitive data. Back it up securely.`);
    
    return Buffer.from(newKey, 'base64');
  } catch (error) {
    console.error('[Crypto] Failed to write master key to .env file:', error);
    // As a last resort, use a machine-specific fallback (less secure but allows operation)
    console.warn('[Crypto] ⚠️  Falling back to machine-specific key derivation (LESS SECURE)');
    return deriveMachineKey();
  }
}

/**
 * Derive a key from machine info as a fallback (less secure).
 * Only used if master key cannot be generated/persisted.
 */
function deriveMachineKey(): Buffer {
  let userInfo = '';
  try {
    userInfo = os.userInfo().username;
  } catch {
    userInfo = 'default-user';
  }
  const machineSeed = `${os.hostname()}-${os.platform()}-${userInfo}`;
  return crypto.createHash('sha256').update(machineSeed).digest();
}

/**
 * Get the master encryption key (cached).
 */
function getMasterKey(): Buffer {
  if (!cachedMasterKey) {
    cachedMasterKey = ensureMasterKey();
  }
  return cachedMasterKey;
}

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_LENGTH = 12; // 96-bit IV standard for AES-GCM
const CBC_IV_LENGTH = 16;

/**
 * Chiffre une chaîne en utilisant AES-256-GCM (chiffrement authentifié).
 * Format de sortie : `gcm:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 */
export function encrypt(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getMasterKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Déchiffre une chaîne chiffrée.
 * Supporte :
 * 1. AES-256-GCM (format `gcm:<iv>:<tag>:<ciphertext>`)
 * 2. Rétrocompatibilité AES-256-CBC (format `<iv>:<ciphertext>`)
 * 3. Fallback texte brut si le contenu n'est pas chiffré.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  try {
    // 1. Format AES-256-GCM : gcm:<iv>:<tag>:<ciphertext>
    if (encryptedText.startsWith('gcm:')) {
      const parts = encryptedText.split(':');
      if (parts.length === 4) {
        const ivHex = parts[1];
        const tagHex = parts[2];
        const cipherHex = parts[3];

        if (
          ivHex.length === GCM_IV_LENGTH * 2 &&
          tagHex.length === 32 &&
          /^[0-9a-fA-F]+$/.test(ivHex) &&
          /^[0-9a-fA-F]+$/.test(tagHex) &&
          /^[0-9a-fA-F]+$/.test(cipherHex)
        ) {
          const iv = Buffer.from(ivHex, 'hex');
          const authTag = Buffer.from(tagHex, 'hex');
          const decipher = crypto.createDecipheriv(GCM_ALGORITHM, getMasterKey(), iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        }
      }
    }

    // 2. Rétrocompatibilité legacy AES-256-CBC : <iv_32chars>:<ciphertext>
    const parts = encryptedText.split(':');
    if (parts.length === 2) {
      if (parts[0].length === CBC_IV_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(parts[0])) {
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv(CBC_ALGORITHM, getMasterKey(), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      }
    }

    return encryptedText;
  } catch {
    // Fallback texte brut si la clé a changé ou si le texte n'était pas chiffré
    return encryptedText;
  }
}

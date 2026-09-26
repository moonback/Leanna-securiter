/**
 * Test du Codebase Skill
 * 
 * Ce fichier teste les nouvelles capacités de modification de fichiers
 * ajoutées au skill codebase.
 */

import { codebaseSkill } from '../server/skills/codebase';

async function testCodebaseSkill() {
  console.log('🧪 Test du Codebase Skill\n');

  // Test 1: Créer un dossier
  console.log('📁 Test 1: Création de dossier');
  const dirResult = await codebaseSkill.handleToolCall('create_project_directory', {
    path: 'test-output/sample'
  });
  console.log('Résultat:', dirResult);

  // Test 2: Créer un fichier
  console.log('\n📝 Test 2: Création de fichier');
  const writeResult = await codebaseSkill.handleToolCall('write_project_file', {
    path: 'test-output/sample/hello.txt',
    content: 'Hello from Leanna!\nThis is a test file.'
  });
  console.log('Résultat:', writeResult);

  // Test 3: Lire le fichier
  console.log('\n📖 Test 3: Lecture du fichier');
  const readResult = await codebaseSkill.handleToolCall('read_project_file', {
    path: 'test-output/sample/hello.txt'
  });
  console.log('Résultat:', readResult);

  // Test 4: Modifier le fichier
  console.log('\n✏️ Test 4: Modification du fichier');
  const modifyResult = await codebaseSkill.handleToolCall('modify_project_file', {
    path: 'test-output/sample/hello.txt',
    searchText: 'Hello from Leanna!',
    replaceText: 'Bonjour from Leanna! 🤖'
  });
  console.log('Résultat:', modifyResult);

  // Test 5: Relire le fichier modifié
  console.log('\n📖 Test 5: Relecture après modification');
  const readResult2 = await codebaseSkill.handleToolCall('read_project_file', {
    path: 'test-output/sample/hello.txt'
  });
  console.log('Contenu:', readResult2.content);

  // Test 6: Supprimer le fichier
  console.log('\n🗑️ Test 6: Suppression du fichier');
  const deleteResult = await codebaseSkill.handleToolCall('delete_project_file', {
    path: 'test-output/sample/hello.txt'
  });
  console.log('Résultat:', deleteResult);

  console.log('\n✅ Tous les tests sont terminés !');
}

// Exécuter les tests si ce fichier est lancé directement
if (require.main === module) {
  testCodebaseSkill().catch(console.error);
}

export { testCodebaseSkill };

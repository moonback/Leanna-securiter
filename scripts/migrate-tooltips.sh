#!/bin/bash

# Script pour identifier et migrer les attributs title= natifs vers le composant Tooltip custom
# Utilisation: ./scripts/migrate-tooltips.sh [--check-only]

SET -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CHECK_ONLY=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --check-only)
      CHECK_ONLY=true
      ;;
  esac
done

echo "=== Tooltip Migration Script ==="
echo "Root: $PROJECT_ROOT"
echo ""

# Fichier de sortie
REPORT_FILE="$PROJECT_ROOT/tooltip-migration-report.md"

echo "Generating report to: $REPORT_FILE"
echo ""

# Initialiser le rapport
cat > "$REPORT_FILE" << 'EOF'
# Tooltip Migration Report

## Summary
- **Total `title=` attributes**: 0
- **With `aria-label`**: 0
- **Without `aria-label` (need migration)**: 0
- **Files to update**: 0

## Files with title= attributes

EOF

# Trouver tous les fichiers TSX avec title=
TITLE_FILES=$(grep -r "title=" "$PROJECT_ROOT/src" --include="*.tsx" --include="*.ts" -l 2>/dev/null | sort | uniq)

TOTAL_TITLE=$(echo "$TITLE_FILES" | wc -l)
TOTAL_COUNT=0
NEED_MIGRATION=0
WITH_ARIA=0

# Compter le nombre total d'occurrences
echo "Counting title= occurrences..."
TOTAL_COUNT=$(grep -r "title=" "$PROJECT_ROOT/src" --include="*.tsx" --include="*.ts" 2>/dev/null | wc -l)

# Pour chaque fichier, vérifier s'il a des title= avec ou sans aria-label
echo "Analyzing files..."

for file in $TITLE_FILES; do
  # Compter les title= dans le fichier
  TITLE_COUNT=$(grep -c "title=" "$file" 2>/dev/null || echo 0)
  
  # Vérifier si le fichier a aussi aria-label
  HAS_ARIA=$(grep -c "aria-label" "$file" 2>/dev/null || echo 0)
  
  # Extraire les lignes avec title= mais sans aria-label sur la même ligne ou la suivante
  NEED_MIGRATION_LINES=$(grep -n "title=" "$file" 2>/dev/null | grep -v "aria-label" || true)
  
  if [ ! -z "$NEED_MIGRATION_LINES" ]; then
    NEED_MIGRATION=$((NEED_MIGRATION + 1))
  fi
  
  # Mettre à jour le rapport
  echo "" >> "$REPORT_FILE"
  echo "### $file" >> "$REPORT_FILE"
  echo "- **title= count**: $TITLE_COUNT" >> "$REPORT_FILE"
  echo "- **aria-label count**: $HAS_ARIA" >> "$REPORT_FILE"
  
  if [ "$NEED_MIGRATION_LINES" != "" ]; then
    echo "- **Lines needing migration**:" >> "$REPORT_FILE"
    echo "$NEED_MIGRATION_LINES" | while read -r line; do
      echo "  - $line" >> "$REPORT_FILE"
    done
  fi
  
done

# Mettre à jour le summary
sed -i "s/Total \`title=\` attributes: 0/Total \`title=\` attributes: $TOTAL_COUNT/" "$REPORT_FILE"

# Calculer le nombre de fichiers à migrer
FILES_TO_UPDATE=$(echo "$TITLE_FILES" | wc -l)
sed -i "s/Files to update: 0/Files to update: $FILES_TO_UPDATE/" "$REPORT_FILE"

echo ""
echo "=== Report Generated ==="
echo "Total files with title=: $TOTAL_COUNT occurrences in $FILES_TO_UPDATE files"
echo "Report saved to: $REPORT_FILE"
echo ""

if [ "$CHECK_ONLY" = true ]; then
  echo "Check-only mode: No changes made."
  exit 0
fi

echo "To migrate, manually update each file based on the report."
echo "Use the Tooltip component:"
echo "  Import: import { Tooltip } from '../components/ui/Tooltip'"
echo "  Usage: <Tooltip content='Your tooltip text' as='button' onClick={handler}><Icon /></Tooltip>"

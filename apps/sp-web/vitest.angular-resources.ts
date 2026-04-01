import type { Plugin } from 'vite';

const TEMPLATE_URL_RE = /templateUrl\s*:\s*(['"`])([^'"`]+)\1/g;
const STYLE_URL_RE = /styleUrl\s*:\s*(['"`])([^'"`]+)\1/g;
const STYLE_URLS_RE = /styleUrls\s*:\s*\[([^\]]*?)\]/g;
const STRING_LITERAL_RE = /(['"`])([^'"`]+)\1/g;

function extractStringLiterals(source: string): string[] | null {
  const values: string[] = [];
  let consumed = '';

  for (const match of source.matchAll(STRING_LITERAL_RE)) {
    values.push(match[2]);
    consumed += match[0];
  }

  if (values.length === 0) {
    return null;
  }

  const normalizedSource = source.replace(/[\s,]/g, '');
  const normalizedConsumed = consumed.replace(/[\s,]/g, '');

  return normalizedSource === normalizedConsumed ? values : null;
}

export function inlineAngularComponentResources(): Plugin {
  return {
    name: 'sp-web:inline-angular-component-resources',
    enforce: 'pre',
    transform(source, id) {
      const filename = id.split('?')[0];

      if (
        !filename.endsWith('.ts') ||
        filename.endsWith('.spec.ts') ||
        !source.includes('@Component(') ||
        (!source.includes('templateUrl:') &&
          !source.includes('styleUrl:') &&
          !source.includes('styleUrls:'))
      ) {
        return null;
      }

      const imports: string[] = [];
      let templateIndex = 0;
      let styleIndex = 0;
      let changed = false;
      let transformed = source;

      transformed = transformed.replace(TEMPLATE_URL_RE, (_full, _quote, resourcePath) => {
        const variableName = `__ngTemplate${templateIndex++}`;
        imports.push(`import ${variableName} from ${JSON.stringify(`${resourcePath}?raw`)};`);
        changed = true;

        return `template: ${variableName}`;
      });

      transformed = transformed.replace(STYLE_URL_RE, (_full, _quote, resourcePath) => {
        const variableName = `__ngStyle${styleIndex++}`;
        imports.push(`import ${variableName} from ${JSON.stringify(`${resourcePath}?inline`)};`);
        changed = true;

        return `styles: [${variableName}]`;
      });

      transformed = transformed.replace(STYLE_URLS_RE, (fullMatch, rawStyleUrls) => {
        const resourcePaths = extractStringLiterals(rawStyleUrls);

        if (!resourcePaths) {
          return fullMatch;
        }

        const variableNames = resourcePaths.map((resourcePath) => {
          const variableName = `__ngStyle${styleIndex++}`;
          imports.push(`import ${variableName} from ${JSON.stringify(`${resourcePath}?inline`)};`);

          return variableName;
        });

        changed = true;

        return `styles: [${variableNames.join(', ')}]`;
      });

      if (!changed) {
        return null;
      }

      return {
        code: `${imports.join('\n')}\n${transformed}`,
      };
    },
  };
}

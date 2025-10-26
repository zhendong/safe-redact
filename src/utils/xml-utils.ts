/**
 * XML parsing and manipulation utilities
 */

/**
 * Parse XML string and check for errors
 */
export function parseXmlSafely(xmlString: string, errorMessage: string = 'Failed to parse XML'): Document {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`${errorMessage}: ${parserError.textContent || 'Unknown error'}`);
  }

  return xmlDoc;
}

/**
 * Serialize XML document to string
 */
export function serializeXml(xmlDoc: Document): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

/**
 * Get elements by tag name with namespace
 */
export function getElementsNS(
  xmlDoc: Document,
  namespace: string,
  tagName: string
): Element[] {
  const nodeList = xmlDoc.getElementsByTagNameNS(namespace, tagName);
  return Array.from(nodeList);
}

/**
 * Remove all elements matching selector
 */
export function removeElements(xmlDoc: Document, namespace: string, tagName: string): number {
  const elements = getElementsNS(xmlDoc, namespace, tagName);
  let removed = 0;

  for (const element of elements) {
    element.parentNode?.removeChild(element);
    removed++;
  }

  return removed;
}

/**
 * Unwrap elements (remove wrapper but keep content)
 */
export function unwrapElements(xmlDoc: Document, namespace: string, tagName: string): number {
  const elements = getElementsNS(xmlDoc, namespace, tagName);
  let unwrapped = 0;

  for (const element of elements) {
    const parent = element.parentNode;
    if (parent) {
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
      unwrapped++;
    }
  }

  return unwrapped;
}

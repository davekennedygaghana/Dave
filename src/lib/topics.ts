export const TOPIC_LABELS: Record<string, string> = {
  trauma: 'Trauma',
  spine: 'Spine',
  sports: 'Sports',
  pediatrics: 'Pediatri',
  tumor: 'Tumor muskuloskeletal',
  'hand-upper-limb': 'Hand and upper limb',
  'foot-ankle': 'Foot and ankle',
  'adult-reconstruction': 'Adult reconstruction',
  infection: 'Infeksi muskuloskeletal',
  'basic-science': 'Basic science',
  other: 'Lain-lain',
};

export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

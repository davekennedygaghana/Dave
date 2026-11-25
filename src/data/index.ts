import type { FactTable } from '../lib/types';
import { TRAUMA } from './trauma';
import { ANATOMY } from './anatomy';
import { CLINICAL } from './clinical';
import { SCIENCE } from './science';

export const TABLES: FactTable[] = [...TRAUMA, ...ANATOMY, ...CLINICAL, ...SCIENCE];

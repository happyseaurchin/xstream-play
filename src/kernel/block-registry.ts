/**
 * Block registry — static name→import map.
 * Star references in agent blocks name these blocks.
 * The kernel looks up the name and walks the block.
 */

import spatialThornkeep from '../../blocks/xstream/spatial-thornkeep.json';
import rulesThornkeep from '../../blocks/xstream/rules-thornkeep.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockRegistry: Record<string, any> = {
  'spatial-thornkeep': spatialThornkeep,
  'rules-thornkeep': rulesThornkeep,
};

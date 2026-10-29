/** Kerf 2D entry point. */
import { tooClose } from './nest/verify';
import { Editor } from './editor/editor';
import { ALL_TOOLS } from './tools';
import { startUI } from './ui/app';
import { loadSample } from './sample';
import { runSelfTest } from './selftest';

const ed = new Editor(ALL_TOOLS);
loadSample(ed);
startUI(ed);
// handy for debugging and automated browser tests
(window as any).KERF = { ed, runSelfTest, tooClose: (gap = 2) => tooClose(ed.doc.ents.filter(e => e.type !== 'dim'), gap, e => ed.groupRoot(e)) };

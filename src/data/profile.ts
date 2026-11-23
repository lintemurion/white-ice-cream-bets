import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { Uid } from '../model/types';
import { cleanText } from './errors';

const NAME_MAX = 30;

/** A member renames herself. The rules let her change only displayName on her own users doc. */
export async function updateMyName(db: Firestore, uid: Uid, displayName: string): Promise<void> {
  const name = cleanText(displayName, NAME_MAX, 'Display name');
  await updateDoc(doc(db, `users/${uid}`), { displayName: name });
}

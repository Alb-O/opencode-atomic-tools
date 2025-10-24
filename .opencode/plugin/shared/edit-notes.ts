type Note = {
  title: string;
  output: string;
  metadata: {
    filePath: string;
    diff: string;
  };
};

const store = new Map<string, Note>();

export function setNote(callID: string, note: Note) {
  store.set(callID, note);
}

export function takeNote(callID: string) {
  const note = store.get(callID);
  if (note) {
    store.delete(callID);
  }
  return note;
}

import { AppState, ContentRecord, ContentRef, KernelRef, NotebookContentRecord, selectors } from "@nteract/core";
import { remote } from "electron";
import path from "path";
import { Store } from "redux";
import { EMPTY, Observable, of } from "rxjs";
import { combineLatestWith, debounceTime, distinctUntilChanged, map, mergeMap, switchMap } from "rxjs/operators";
import { KernelStatus } from "@nteract/types";

const HOME = remote.app.getPath("home");

/**
 * Turn a path like /Users/n/mine.ipynb to ~/mine.ipynb
 * @param  {string} p the full path to a file
 * @return {string}   tildified path
 */
export function tildify(p?: string): string {
  if (!p) {
    return "";
  }
  const s = path.normalize(p) + path.sep;
  return (s.indexOf(HOME) === 0
    ? s.replace(HOME + path.sep, `~${path.sep}`)
    : s
  ).slice(0, -1);
}

interface Attributes {
  fullpath: string;
  modified: boolean;
  kernelStatus?: string | null;
}

export function setTitleFromAttributes(attributes: Attributes): void {
  const filename = tildify(attributes.fullpath);
  const { kernelStatus } = attributes;

  try {
    const win = remote.getCurrentWindow();
    if (filename && win.setRepresentedFilename) {
      win.setRepresentedFilename(attributes.fullpath);
      win.setDocumentEdited(attributes.modified);
    }
    const title = `${filename} - ${kernelStatus}`;
    win.setTitle(title);
  } catch (e) {
    /* istanbul ignore next */
    // log1277
    if (e instanceof Error)
    {
      (() => {
        console.error(
          "Unable to set the filename, see https://github.com/nteract/nteract/issues/1277"
        );
        console.error(e);
        console.error(e.stack);
      })();
    } 
  }
}

export function createTitleFeed(
  contentRef: ContentRef,
  state$: Observable<AppState>
): Observable<Attributes> {
  const content$: Observable<ContentRecord> = state$.pipe(
    mergeMap((state: AppState) => {
      const content = selectors.content(state, { contentRef });
      if (content) {
        return of(content);
      } else {
        return EMPTY;
      }
    })
  );

  const fullpath$ = content$.pipe(
    map(content => content.filepath || "Untitled"),
    distinctUntilChanged()
  );

  const modified$ = content$.pipe(
    map(untypedContent => {
      // In desktop we can safely assume that the model is a notebook model
      const content = untypedContent as NotebookContentRecord;
      return selectors.notebook.isDirty(content.model);
    }),
    distinctUntilChanged()
  );

  const kernelRef$ = content$.pipe(
    mergeMap(content => {
      if (content && content.type === "notebook") {
        return of(content.model.kernelRef);
      } else {
        return EMPTY;
      }
    })
  );

  const kernelStatus$ = state$.pipe(
    combineLatestWith(kernelRef$),
    map(([state, kernelRef]) => {
      if (!kernelRef)
      {
        return KernelStatus.NotConnected;
      }
      const kernel = selectors.kernel(state, { kernelRef });
      if (!kernel) {
        return KernelStatus.NotConnected;
      } else {
        return kernel.status;
      }
    }),
    debounceTime(200));

  return modified$.pipe(
    combineLatestWith(fullpath$, kernelStatus$),
    map(([modified, fullpath, kernelStatus]) => ({
      fullpath,
      kernelStatus: kernelStatus ? kernelStatus.toString() : null,
      modified
    })),
    distinctUntilChanged(),
    switchMap(i => of(i)));
}

export function initNativeHandlers(
  contentRef: ContentRef,
  store: Store<AppState, any>
) {
  const state$ = new Observable<AppState>(observer => {
    const unsubscribe = store.subscribe(() => {
      observer.next(store.getState());
    });
    return unsubscribe;
  });

  return createTitleFeed(contentRef, state$).subscribe(
    setTitleFromAttributes,
    (err: Error) => console.error(err)
  );
}

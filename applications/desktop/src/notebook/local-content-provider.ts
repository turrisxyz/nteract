import { Notebook, stringifyNotebook } from "@nteract/commutable";
import { FileType, ICheckpoint, IContent, IContentProvider, IGetParams, ServerConfig } from "@nteract/types";
import * as fs from "fs";
import { readFileObservable, statObservable, writeFileObservable } from "fs-observable";
import { Record } from "immutable";
import * as path from "path";
import { Observable, of } from "rxjs";
import { AjaxResponse, AjaxRequest, ajax } from "rxjs/ajax";
import { catchError, map, mergeMap } from "rxjs/operators";
import { string } from "yargs";

// A Content provider which reads/writes to local disk
export class LocalContentProvider implements IContentProvider {
  public remove(serverConfig: ServerConfig, path: string): Observable<AjaxResponse<void>> {
    throw new Error("Not implemented");
  }
  
  public get(serverConfig: ServerConfig, filePath: string, params: Partial<IGetParams>): Observable<AjaxResponse<IContent>> {
    return statObservable(filePath).pipe(
      mergeMap((stat: fs.Stats) => {
        if (!stat.isFile()) {
          return of(this.createErrorAjaxResponse(400, new Error("Attempted to open something which is not a file")));
        }

        if (params.content === 0) {
          const notebook = this.createNotebookModel(filePath, stat);
          return of(this.createSuccessAjaxResponse(notebook));
        }

        return readFileObservable(filePath).pipe(
          map((content: Buffer) => {
            const notebook = this.createNotebookModel(filePath, stat, content.toString());
            return this.createSuccessAjaxResponse(notebook);
          }),
          catchError(error => of(this.createErrorAjaxResponse(404, error)))
        )
      }),
      catchError(error => of(this.createErrorAjaxResponse(404, error)))
    );
  }

  public update<FT extends FileType>(serverConfig: ServerConfig, path: string, model: Partial<IContent<FT>>): Observable<AjaxResponse<IContent>> {
    throw new Error("Not implemented");
  }

  public create<FT extends FileType>(serverConfig: ServerConfig, path: string, model: Partial<IContent<FT>> & { type: FT }): Observable<AjaxResponse<IContent>> {
    throw new Error("Not implemented");
  }

  public save<FT extends FileType>(serverConfig: ServerConfig, filePath: string, model: Partial<IContent<FT>>): Observable<AjaxResponse<IContent>> {
    const notebook: Notebook = model.content as Notebook;
    if (!notebook || model.type !== "notebook") {
      return of(this.createErrorAjaxResponse(400, new Error("No notebook found to save")));
    }
    
    const serializedNotebook = stringifyNotebook(notebook);
    return writeFileObservable(filePath, serializedNotebook).pipe(
      mergeMap(() => {
        return statObservable(filePath).pipe(
          map((stat: fs.Stats) => {
            const notebook = this.createNotebookModel(filePath, stat, serializedNotebook);
            return this.createSuccessAjaxResponse(notebook);
          }),
          catchError(error => of(this.createErrorAjaxResponse(404, error)))
        )
      }),
      catchError(error => of(this.createErrorAjaxResponse(500, error)))
    );
  }

  public listCheckpoints(serverConfig: ServerConfig, path: string): Observable<AjaxResponse<ICheckpoint[]>> {
    throw new Error("Not implemented");
  }

  public createCheckpoint(serverConfig: ServerConfig, path: string): Observable<AjaxResponse<ICheckpoint>> {
    throw new Error("Not implemented");
  }

  public deleteCheckpoint(serverConfig: ServerConfig, path: string, checkpointID: string): Observable<AjaxResponse<void>> {
    throw new Error("Not implemented");
  }

  public restoreFromCheckpoint(serverConfig: ServerConfig, path: string, checkpointID: string): Observable<AjaxResponse<void>> {
    throw new Error("Not implemented");
  }

  private createNotebookModel(filePath: string, stat: fs.Stats, content?: string): IContent<"notebook"> {
    const parsedFilePath = path.parse(filePath);

    const name = parsedFilePath.base;
    // tslint:disable-next-line no-bitwise
    const writable = Boolean(fs.constants.W_OK & stat.mode);
    const created = stat.birthtime.toString();
    // tslint:disable-next-line variable-name -- jupyter camel case naming convention for API
    const last_modified = stat.mtime.toString();

    return {
      name,
      path: filePath,
      type: "notebook",
      writable,
      created,
      last_modified,
      mimetype: "application/x-ipynb+json",
      content: content ? JSON.parse(content) : null,
      format: "json"
    };
  }

  private createSuccessAjaxResponse(notebook: IContent<"notebook">): AjaxResponse<IContent<"notebook">> {
    return {
      originalEvent: new ProgressEvent("no-op"),
      xhr: new XMLHttpRequest(),
      status: 200,
      response: notebook,
      responseType: "json",
      type: "download_load",
      loaded: 0,
      total: 0,
      request: {} as AjaxRequest,
      responseHeaders: { "ContentProvider" : "local" }
    };
  }

  private createErrorAjaxResponse(status: number, error: any): AjaxResponse<any> {
    return {
      originalEvent: new ProgressEvent("no-op"),
      xhr: new XMLHttpRequest(),
      status,
      response: error,
      responseType: "json",
      type: "download_load",
      loaded: 0,
      total: 0,
      request: {} as AjaxRequest,
      responseHeaders: { "ContentProvider" : "local" }
    };
  }
}

import { actions, selectors } from "@nteract/core";
import { sendNotification } from "@nteract/mythic-notifications";
import { openExternalUrl } from "@nteract/mythic-windowing";

import { Octokit } from "@octokit/rest"
import * as path from "path";
import { ofType, StateObservable } from "redux-observable";
import { from, concat, EMPTY, Observable, of } from "rxjs";
import { catchError, mergeMap } from "rxjs/operators";
import { DesktopNotebookAppState } from "../state";

interface GithubFiles {
  [result: string]: {
    // Raw file as string
    content: string;
    // Specify the filename on update to rename it
    filename?: string;
  } | null; // Null allows for deletes
}

function publishGist(
  model: Partial<{ [key: string]: unknown; }>,
  token: string,
  id: string | null
) {
  const octokit = new Octokit({ auth: token });
  return id != null ? 
    octokit.rest.gists.update({ gist_id: id, ...model }) :
    octokit.rest.gists.create(model as any);
}

/**
 * Epic to capture the end to end action of publishing and receiving the
 * response from the Github API.
 */
export const publishEpic = (
  action$: Observable<actions.PublishGist>,
  state$: StateObservable<DesktopNotebookAppState>
) => {
  return action$.pipe(
    ofType(actions.PUBLISH_GIST),
    mergeMap((action: actions.PublishGist) => {
      const state = state$.value;

      const contentRef = action.payload.contentRef;
      if (!contentRef) {
        return EMPTY;
      }

      const content = selectors.content(state, { contentRef });
      // NOTE: This could save by having selectors for each model type
      //       have toDisk() selectors
      if (!content || content.type !== "notebook") {
        return EMPTY;
      }

      const filepath = content.filepath;

      const model = content.model;

      const notebookString = selectors.notebook.asString(model);
      const gistId = selectors.notebook.gistId(model);

      // Allow falling back on the GITHUB_TOKEN environment variable
      const githubToken = state.app.get("githubToken");

      if (githubToken == null) {
        return of(
          actions.coreError(
            new Error("need a github token in order to publish")
          )
        );
      }

      if (gistId && typeof gistId !== "string") {
        return of(
          actions.coreError(new Error("gist id in notebook is not a string"))
        );
      }

      // We are updating, so we require both a gist Id and a github token
      // If this doesn't happen to be our originally gisted notebook,
      // we should likely fork and publish
      //
      // TODO: Check to see if the token matches that of the username listed
      //       in the notebook itself
      const filename = filepath ? path.parse(filepath).base : "Untitled.ipynb";
      const files: GithubFiles = {
        [filename]: { content: notebookString }
      };

      return concat(
        of(
          sendNotification.create({
            key: "github-publish",
            icon: "book",
            title: "Publishing Gist",
            message: gistId
              ? "Updating Gist... 💖📓💖"
              : "Publishing a new Gist... ✨📓✨",
            level: "in-progress",
          })
        ),
        from(publishGist(
          { files, description: filename, public: false },
          githubToken,
          gistId,
        )).pipe(
          mergeMap(githubResponse =>
            of(
              actions.overwriteMetadataField({
                field: "github_username",
                value: githubResponse.data.owner?.name,
                contentRef,
              }),
              actions.overwriteMetadataField({
                field: "gist_id",
                value: githubResponse.data.id,
                contentRef,
              }),
              sendNotification.create({
                key: "github-publish",
                title: "Publishing Gist",
                message: "Gist uploaded 📓📢",
                level: "success",
                action: {
                  label: "Open",
                  callback: () => window.store.dispatch(openExternalUrl.create(`https://nbviewer.jupyter.org/${githubResponse.data.id}`)),
                },
              }),
            )
          ),
          catchError(err => {
            // Turn the response headers into an object
            const arr: string[] = err.xhr.getAllResponseHeaders().split("\r\n");
            const headers: { [header: string]: string } = arr.reduce(
              (acc: { [header: string]: string }, current) => {
                const parts = current.split(": ");
                acc[parts[0]] = parts[1];
                return acc;
              },
              {}
            );

            // If we see the oauth scopes don't list gist,
            // we know the problem is the token's access
            if (
              headers.hasOwnProperty("X-OAuth-Scopes") &&
              !headers["X-OAuth-Scopes"].includes("gist")
            ) {
              return of(
                actions.coreError(
                  new Error(
                    "Bad GitHub Token: the gist API reports that the token " +
                    "doesn't have gist scopes 🤷‍♀️")
                )
              );
            }

            if (err.status >= 500) {
              // Likely a GitHub API error
              return of(actions.coreError(new Error(
                "Gist publishing failed: 😩 GitHub API not feelin' good today"
              )));
            }

            return of(actions.coreError(err));
          })
        ),
      );
    }),
  );
};

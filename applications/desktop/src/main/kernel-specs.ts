import { Action, makeActionFunction } from "@nteract/actions";
import { Kernelspecs } from "@nteract/types";
import kernelspecs from "kernelspecs";
import { join } from "path";
import { from } from "rxjs";
import { filter, map } from "rxjs/operators";


export const kernelSpecs$ =
  from(
    kernelspecs.findAll()
  ).pipe<Kernelspecs>(
    map((specs: object) => ({
      ...specs,
      node_nteract: {
        name: "node_nteract",
        spec: {
          argv: [
            process.execPath,
            join(__dirname, "..", "node_modules", "ijavascript", "lib", "kernel.js"),
            "{connection_file}",
            "--protocol=5.0",
            "--hide-undefined",
          ],
          display_name: "Node.js (nteract)",
          language: "javascript",
          env: {
            ELECTRON_RUN_AS_NODE: "1",
            NODE_PATH: join(__dirname, "..", "node_modules"),
          },
        },
      },
    } as Kernelspecs)),
  );

export const bestKernelObservable =
  (requested: string | undefined, fallback: string) =>
    kernelSpecs$
      .pipe(
        map(
          (specs: Kernelspecs) => {
            let kernel: string = fallback;

            if (requested && requested in specs) {
              kernel = requested;
            } else if (!kernel || !(kernel in specs)) {
              const specList = Object.keys(specs);
              specList.sort();
              kernel = specList[0];
            }

            if (kernel && specs[kernel]) {
              return specs[kernel];
            } else {
              throw new Error(`can't find kernel "${kernel}" in:\n${specs}`);
            }
          }
        )
      );

export const SET_KERNELSPECS = "SET_KERNELSPECS";
export type  SetKernelspecs  = Action<typeof SET_KERNELSPECS, { kernelSpecs: Kernelspecs }>;
export const setKernelspecs  = makeActionFunction<SetKernelspecs>(SET_KERNELSPECS);

kernelSpecs$
  .pipe(
    filter(kernelSpecs => Object.keys(kernelSpecs).length > 0),
  )
  .subscribe(
    kernelSpecs =>
      global.store.dispatch(setKernelspecs({ kernelSpecs })),
  );

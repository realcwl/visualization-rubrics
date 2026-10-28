# Visualization Rubrics

A personal collection of interactive visualizations and reusable references for
explaining complex ideas. These examples form a starting point for visualizing
more subjects over time: connecting scales, showing mechanisms, and letting
people explore how a system works.

## Visualizations

| Example | What it shows | Files |
| --- | --- | --- |
| Matmul on Silicon | How a TPU and GPU execute matrix multiplication, with memory movement, compute, and partial sums shown side by side. | [Source and guide](visualization/gpu/) |
| TPU Systolic Array | A grid of multiply-adders and the flow of matrix data through a systolic array. | [HTML](visualization/systolic/systolic-array.html) |
| TPU Deep Zoom | A visualization spanning Earth, a data center, and the compute within a TPU. Includes an earlier version, textures, capture scripts, stills, and rendered videos. | [Source and assets](visualization/tpu/) |

## Run locally

Clone with Git LFS installed to download the included videos:

```bash
git lfs install
git clone https://github.com/realcwl/visualization-rubrics.git
cd visualization-rubrics
```

If you already cloned without the videos, run `git lfs pull` from the repository.

### GPU / TPU comparison

Requires Node.js and npm.

```bash
cd visualization/gpu
npm ci
npm run dev
```

Open the local URL printed by Vite. See the [example's README](visualization/gpu/README.md)
for controls, implementation details, and modeling simplifications.
Use `npm run build` to produce a production build.

### Standalone HTML examples

From the repository root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

- TPU Deep Zoom: <http://localhost:8000/visualization/tpu/>
- Earlier TPU version: <http://localhost:8000/visualization/tpu/index-v1.html>
- Systolic Array: <http://localhost:8000/visualization/systolic/systolic-array.html>

These pages load Three.js and fonts from external CDNs, so they need internet access.

## Rubric for future visualizations

- **Start with a question.** Make the concept the viewer should understand explicit.
- **Show the mechanism.** Use movement, structure, and state changes to explain what happens.
- **Make scale readable.** Label units, connect levels of detail, and explain visual compression.
- **Keep visual meaning consistent.** Reuse colors and shapes for equivalent roles.
- **Support exploration.** Provide useful controls such as pause, scrub, zoom, and inspection.
- **State the limits.** Document sources, assumptions, and illustrative simplifications.
- **Make it reproducible.** Include source, required assets, and instructions to run the example.

Add new subjects under `visualization/<topic>/` and link them in the table above.
Keep reusable references, source assets, and intentional rendered outputs with the
example. Videos are stored through Git LFS; dependencies, build output, and local
tooling state are ignored.

## Credits and license

The GPU/TPU comparison credits *How to Scale Your Model* in its
[README](visualization/gpu/README.md). The TPU Deep Zoom source credits NASA Blue
Marble and Black Marble imagery. The examples use Three.js and Google Fonts.

Original project code is available under the [MIT License](LICENSE). Third-party
libraries, fonts, and imagery retain their respective terms.

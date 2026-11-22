# UI/UX Design System — Python Auto Grader (Pastel Kawaii 3D Style)

## 1. Visual Direction
- **Theme:** Light Dreamy Pastel Kawaii 3D SaaS (never dark theme by default).
- **Mood:** Warm, cute, approachable, premium educational tool while keeping score tables and Python code crystal-clear and easy to read.

## 2. Color Tokens
| Token | Hex | Usage |
|---|---|---|
| `--soft-lavender` | `#E8D9FA` | Sidebar accent, card borders, soft pills, table headers |
| `--pastel-purple` | `#B895E8` | Primary gradient start, focus rings, pastel icons |
| `--medium-purple` | `#9870D4` | Primary gradient end, active highlights |
| `--deep-lavender` | `#684A96` | Primary headings, active text, high-contrast labels |
| `--baby-pink` | `#F8E1EE` | Ambient gradient glow, decorative hero banner |
| `--soft-peach` | `#FFF1E4` | Warm secondary tint, Excel/export highlights |
| `--cream-white` | `#FFFAF5` | Base dreamy canvas tint & row hover |
| `--pure-white` | `#FFFFFF` | Cards, inputs, table rows |
| `--mint-green` | `#DDF1E7` | Passed / Approved status badges |
| `--soft-yellow` | `#FFE5A9` | Queued / Pending badges |
| `--powder-blue` | `#DCEBFA` | Submitted / Info accents |
| `--light-pink` | `#F7DCE8` | Error / Attention pastel alerts |

## 3. Typography
- **Headings:** `Mitr` (rounded, friendly Thai/Latin display font)
- **Body / Tables:** `Anuphan` (clean, legible Thai/English sans-serif)
- **Python Code Viewer:** `JetBrains Mono`

## 4. Component Tokens
- **Cards (`.card-soft`)**: `border-radius: 1.75rem`, pure white surface, `1.5px solid #E8D9FA`, soft lavender-pink shadow.
- **Buttons (`.btn-kawaii`, `.btn-kawaii-soft`, `.btn-kawaii-peach`)**: Capsule/pill (`rounded-full`), soft gradient, gentle lift on hover.
- **Inputs**: `rounded-2xl`, pure white background, `#E8D9FA` border, `#B895E8` focus halo.
- **Tables**: Soft lavender-to-pink header, pure white data rows, pastel pill status badges.
- **3D Illustrations**: Stored in `frontend/public/illustrations/` (`hero-mascot.png`, `empty-state.png`) and used selectively on Login, Dashboard Hero, Loading, and Empty States without obscuring data.

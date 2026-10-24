export function PackageDiagram() {
  return (
    <svg
      className="package-diagram"
      viewBox="0 0 300 146"
      role="img"
      aria-label="梱包箱の幅・奥行・高さの測り方。外側の破線は各面に追加する安全マージン。"
    >
      <path
        className="diagram-margin"
        d="M74 46 152 13 231 49 231 108 150 141 74 107Z M74 46 151 82 231 49 M151 82V141"
      />
      <path className="diagram-top" d="M84 50 152 23 221 53 152 82Z" />
      <path className="diagram-front" d="M84 50 152 82V130L84 101Z" />
      <path className="diagram-side" d="m152 82 69-29v50l-69 27Z" />
      <path
        className="diagram-tape"
        d="m113 38 68 31 12-5-68-31Z M181 69v22l12-5V64Z"
      />
      <path
        className="diagram-measure"
        d="m67 57-12 5v51l12-5 M50 64l10-4 M50 114l10-4 M88 116l47 21 M88 111v10 M135 132v10 M169 142l63-27 M169 137v10 M232 110v10"
      />
      <text x="37" y="91">
        H
      </text>
      <text x="108" y="143">
        W
      </text>
      <text x="218" y="141">
        D
      </text>
    </svg>
  );
}

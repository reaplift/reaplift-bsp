export function PushCampaign() {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Push campaign</h2>
      </div>

      <form className="form-grid">
        <label>
          <span>Campaign name</span>
          <input type="text" placeholder="Weekend launch campaign" defaultValue="Weekend launch" />
        </label>

        <label>
          <span>Audience</span>
          <input type="text" placeholder="New leads" defaultValue="VIP customers" />
        </label>

        <label>
          <span>Message template</span>
          <textarea rows={5} defaultValue="Hi {{name}}, your exclusive offer is live now. Tap to explore the latest updates." />
        </label>

        <label>
          <span>Schedule</span>
          <input type="datetime-local" defaultValue="2026-10-18T18:30" />
        </label>

        <button type="submit" className="primary-button">
          Schedule campaign
        </button>
      </form>
    </div>
  );
}

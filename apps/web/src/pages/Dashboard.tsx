import { StatCard } from '../components/StatCard';
import { campaigns, dashboardSummary } from '../data/mockData';

export function Dashboard() {
  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Messages sent" value={dashboardSummary.totalSent.toLocaleString()} trend="+12.4%" />
        <StatCard label="Delivered" value={dashboardSummary.delivered.toLocaleString()} trend="+8.1%" />
        <StatCard label="Read rate" value={`${dashboardSummary.readRate}%`} trend="+2.3%" />
        <StatCard label="Active campaigns" value={String(dashboardSummary.activeCampaigns)} trend="4 scheduled" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent campaigns</h2>
          <button type="button" className="link-button">
            View all
          </button>
        </div>

        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="campaign-row">
              <div>
                <strong>{campaign.name}</strong>
                <small>
                  {campaign.audience} · {campaign.template}
                </small>
              </div>
              <span className={`status-pill status-${campaign.status}`}>{campaign.status}</span>
              <time>
                {campaign.scheduledAt ? new Date(campaign.scheduledAt).toLocaleString() : 'Not scheduled'}
              </time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

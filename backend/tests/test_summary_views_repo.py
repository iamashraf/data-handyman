from app.models.summary import SummaryViewCreate
from app.repository import summary_views_repo


def test_create_view_returns_view_with_id_and_timestamps(db_conn):
    view = summary_views_repo.create_view(
        db_conn,
        template_id=1,
        view=SummaryViewCreate(name="By status", group_by=["status"], metric="amount", chart_type="bar"),
    )
    assert view.id is not None
    assert view.template_id == 1
    assert view.name == "By status"
    assert view.group_by == ["status"]
    assert view.metric == "amount"
    assert view.chart_type == "bar"
    assert view.created_at and view.updated_at


def test_create_view_defaults_chart_type_to_bar(db_conn):
    view = summary_views_repo.create_view(
        db_conn,
        template_id=1,
        view=SummaryViewCreate(name="V", group_by=["status"]),
    )
    assert view.chart_type == "bar"
    assert view.metric is None


def test_list_views_only_returns_views_for_that_template(db_conn):
    summary_views_repo.create_view(
        db_conn, template_id=1, view=SummaryViewCreate(name="A", group_by=["status"])
    )
    summary_views_repo.create_view(
        db_conn, template_id=2, view=SummaryViewCreate(name="B", group_by=["region"])
    )
    views = summary_views_repo.list_views(db_conn, template_id=1)
    assert [v.name for v in views] == ["A"]


def test_list_views_supports_multiple_group_by_columns(db_conn):
    summary_views_repo.create_view(
        db_conn,
        template_id=1,
        view=SummaryViewCreate(name="Combo", group_by=["region", "status"]),
    )
    (view,) = summary_views_repo.list_views(db_conn, template_id=1)
    assert view.group_by == ["region", "status"]


def test_get_view_returns_none_when_missing(db_conn):
    assert summary_views_repo.get_view(db_conn, view_id=999) is None


def test_get_view_returns_the_created_view(db_conn):
    created = summary_views_repo.create_view(
        db_conn, template_id=1, view=SummaryViewCreate(name="A", group_by=["status"])
    )
    fetched = summary_views_repo.get_view(db_conn, view_id=created.id)
    assert fetched == created


def test_delete_view_removes_it(db_conn):
    created = summary_views_repo.create_view(
        db_conn, template_id=1, view=SummaryViewCreate(name="A", group_by=["status"])
    )
    summary_views_repo.delete_view(db_conn, view_id=created.id)
    assert summary_views_repo.get_view(db_conn, view_id=created.id) is None

from app.models.record import RecordRead
from app.services.summary_service import compute_summary


def _rec(id, data, computed=None):
    return RecordRead(
        id=id,
        template_id=1,
        data=data,
        computed=computed or {},
        created_at="",
        updated_at="",
    )


def test_compute_summary_counts_by_group():
    records = [
        _rec(1, {"status": "Open"}),
        _rec(2, {"status": "Open"}),
        _rec(3, {"status": "Closed"}),
    ]
    result = compute_summary(records, group_by=["status"])
    by_group = {r.group_values["status"]: r.count for r in result}
    assert by_group == {"Open": 2, "Closed": 1}


def test_compute_summary_sums_metric_per_group():
    records = [
        _rec(1, {"status": "Open", "amount": 2}),
        _rec(2, {"status": "Open", "amount": 3.5}),
        _rec(3, {"status": "Closed", "amount": 10}),
    ]
    result = {r.group_values["status"]: r for r in compute_summary(records, ["status"], "amount")}
    assert result["Open"].sum == 5.5
    assert result["Closed"].sum == 10


def test_compute_summary_skips_non_numeric_metric_values():
    records = [
        _rec(1, {"status": "Open", "amount": 4}),
        _rec(2, {"status": "Open", "amount": "n/a"}),
        _rec(3, {"status": "Open", "amount": True}),
        _rec(4, {"status": "Open"}),
    ]
    (row,) = compute_summary(records, ["status"], "amount")
    assert row.count == 4
    assert row.sum == 4


def test_compute_summary_reads_group_and_metric_from_computed():
    records = [
        _rec(1, {"amount": 1}, computed={"bucket": "A", "total": "#VALUE!"}),
        _rec(2, {"amount": 2}, computed={"bucket": "A", "total": 7}),
    ]
    (row,) = compute_summary(records, ["bucket"], "total")
    assert row.group_values == {"bucket": "A"}
    assert row.count == 2
    assert row.sum == 7


def test_compute_summary_sum_is_none_without_metric():
    records = [_rec(1, {"status": "Open"})]
    (row,) = compute_summary(records, ["status"])
    assert row.sum is None


def test_compute_summary_empty_input_returns_empty_list():
    assert compute_summary([], ["status"]) == []


def test_compute_summary_groups_unhashable_values_without_raising():
    records = [
        _rec(1, {"tags": ["a", "b"]}),
        _rec(2, {"tags": ["a", "b"]}),
        _rec(3, {"tags": {"k": 1}}),
    ]
    result = {r.group_values["tags"]: r.count for r in compute_summary(records, ["tags"])}
    assert result == {'["a", "b"]': 2, '{"k": 1}': 1}


def test_compute_summary_with_multiple_group_by_columns_groups_by_combination():
    records = [
        _rec(1, {"region": "West", "status": "Open"}),
        _rec(2, {"region": "West", "status": "Open"}),
        _rec(3, {"region": "West", "status": "Closed"}),
        _rec(4, {"region": "East", "status": "Open"}),
    ]
    result = compute_summary(records, ["region", "status"])
    by_combo = {
        (r.group_values["region"], r.group_values["status"]): r.count for r in result
    }
    assert by_combo == {
        ("West", "Open"): 2,
        ("West", "Closed"): 1,
        ("East", "Open"): 1,
    }
    for row in result:
        assert set(row.group_values) == {"region", "status"}

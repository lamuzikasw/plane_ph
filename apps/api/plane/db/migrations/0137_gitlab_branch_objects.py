from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0136_gitlab_discovery_heads"),
    ]

    operations = [
        migrations.AlterField(
            model_name="gitlabobject",
            name="kind",
            field=models.CharField(
                choices=[
                    ("mr", "mr"),
                    ("commit", "commit"),
                    ("pipeline", "pipeline"),
                    ("job", "job"),
                    ("branch", "branch"),
                ],
                max_length=20,
            ),
        ),
    ]
